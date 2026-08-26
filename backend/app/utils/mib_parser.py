"""MIB file parser — extracts OID definitions from ASN.1 MIB files."""
import re


def parse_mib_file(content: str) -> list[dict]:
    """Parse a MIB file and return list of {oid, name, description, syntax}."""
    results = []
    current = None
    for line in content.split('\n'):
        line = line.split('--')[0].strip()  # remove comments
        if not line: continue

        # Match: name OBJECT-TYPE or name OBJECT IDENTIFIER
        m = re.match(r'^(\w[\w-]*)\s+OBJECT-?TYPE', line, re.IGNORECASE)
        if m:
            if current and current.get('oid'): results.append(current)
            current = {'name': m.group(1), 'oid': None, 'description': '', 'syntax': ''}
            continue

        # Skip if no current object
        if not current: continue

        # SYNTAX
        sm = re.match(r'SYNTAX\s+(.+)', line, re.IGNORECASE)
        if sm: current['syntax'] = sm.group(1); continue

        # DESCRIPTION
        dm = re.match(r'DESCRIPTION\s+"([^"]*)"', line, re.IGNORECASE)
        if dm: current['description'] = dm.group(1); continue

        # ::= { parent number } — OID value assignment
        om = re.match(r'::=\s*\{\s*(.+)\s*\}', line)
        if om:
            oid_tail = om.group(1).strip()
            current['oid'] = oid_tail
            continue

        # MODULE-IDENTITY or IMPORTS — skip
        if re.match(r'^(IMPORTS|EXPORTS|MODULE-IDENTITY|FROM|END|BEGIN)', line, re.IGNORECASE):
            if current and current.get('oid'): results.append(current)
            current = None

    if current and current.get('oid'): results.append(current)
    return results


def parse_cisco_supportlist(html_content: str) -> list[dict]:
    """解析 Cisco MIB 支持列表 HTML，返回 [{name, url}] 列表。"""
    results = []
    for m in re.finditer(r'<a\s+href="([^"]+\.my)"[^>]*>([^<]+)</a>', html_content, re.IGNORECASE):
        url, name = m.group(1), m.group(2).strip()
        if url.startswith('ftp://'): url = url.replace('ftp://ftp.cisco.com/pub/mibs/v2/',
            'https://raw.githubusercontent.com/cisco/cisco-mibs/main/v2/')
        results.append({"name": name, "url": url})
    return results


def download_and_parse_mib(url: str, timeout: int = 10) -> dict[str, str]:
    """下载 .my MIB 文件并解析其中的 OID 定义。"""
    import urllib.request
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'NMS/1.0'})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            content = resp.read().decode('utf-8', errors='replace')
        return parse_mib_oids(content)
    except Exception:
        return {}


def parse_mib_oids(content: str) -> dict[str, str]:
    """从 Cisco .my MIB 文件中提取 {name: OID} 映射。"""
    oids = {}

    # 第一遍：收集所有 OBJECT IDENTIFIER 定义和 OBJECT-TYPE 定义
    # Cisco MIB 格式：name OBJECT-TYPE\n  SYNTAX ...\n  ::= { parent number }
    id_assignments = {}  # name -> numeric OID

    # 先收集 MODULE-IDENTITY 的根 OID
    module_match = re.search(r'(\w[\w-]*)\s+MODULE-IDENTITY\s*.*?::=\s*\{([^}]+)\}', content, re.DOTALL | re.IGNORECASE)
    if module_match:
        ref = module_match.group(2).strip()
        nums = re.findall(r'\b(\d+)\b', ref)
        if nums: id_assignments['_module_root'] = '.'.join(nums)

    # 收集所有 OBJECT IDENTIFIER 赋值
    for m in re.finditer(r'^(\w[\w-]*)\s+OBJECT\s+IDENTIFIER\s*::=\s*\{([^}]+)\}', content, re.MULTILINE | re.IGNORECASE):
        name, ref = m.group(1), m.group(2).strip()
        id_assignments[name] = ref

    # 解析每个 OBJECT-TYPE 条目
    # 格式: name OBJECT-TYPE ... ::= { parentRef number }
    for m in re.finditer(r'(\w[\w-]*)\s+OBJECT-TYPE\s*.*?::=\s*\{([^}]+)\}', content, re.DOTALL | re.IGNORECASE):
        name = m.group(1)
        ref = m.group(2).strip()
        # ref 可能是 "ciscoMgmt 123" 或 "1.3.6.1.4.1.9.9.123"
        parts = ref.split()
        if not parts: continue

        # 直接数字 OID
        if all(p.replace('.','').isdigit() for p in parts if p.replace('.','').isdigit()):
            resolved = ref.replace(' ', '.')
            oids[name] = resolved
            continue

        # 需要解析父引用
        parent = parts[0]
        tail_nums = [p for p in parts[1:] if p.strip().isdigit()]
        if parent in id_assignments:
            base = id_assignments[parent]
            # 解析父引用中的数字
            base_nums = re.findall(r'\b(\d+)\b', base)
            if base_nums:
                oids[name] = '.'.join(base_nums + tail_nums)
            else:
                oids[name] = base + ('.' + '.'.join(tail_nums) if tail_nums else '')
        elif parent == 'ciscoMgmt':
            # 兜底：已知 Cisco 管理 OID 前缀
            oids[name] = '1.3.6.1.4.1.9.9.' + '.'.join(tail_nums) if tail_nums else ''
        elif parent == 'enterprises':
            oids[name] = '1.3.6.1.4.1.' + '.'.join(tail_nums) if tail_nums else ''

    return oids


def resolve_oids_second_pass(oids: dict[str, str]) -> dict[str, str]:
    """第二遍解析：用已收集的 OID 映射交叉引用，解析剩余的非数字 OID。"""
    # 先建立数字 OID 的 name→oid 映射
    name_to_oid = {}
    for name, oid in oids.items():
        if oid and all(c.isdigit() or c == '.' for c in oid):
            name_to_oid[name] = oid

    resolved = {}
    for name, oid in oids.items():
        if oid and all(c.isdigit() or c == '.' for c in oid):
            resolved[name] = oid  # 已是数字，保持
            continue
        if not oid:
            continue
        # 尝试解析 parentRef.number 格式
        parts = oid.strip().split()
        if len(parts) >= 2:
            parent = parts[0]
            tail = '.'.join(p for p in parts[1:] if p.strip())
            if parent in name_to_oid:
                resolved[name] = name_to_oid[parent] + '.' + tail
                continue
        # 尝试查找 name 本身
        if name in name_to_oid:
            resolved[name] = name_to_oid[name]
        else:
            resolved[name] = oid  # 保留原值
    return resolved


def resolve_oids_with_db(oids: dict[str, str], po_map: dict[str, str]) -> dict[str, str]:
    """使用数据库中的 ParsedOid 映射解析 OID（作为第三遍回退）。"""
    resolved = {}
    for name, oid in oids.items():
        if oid and all(c.isdigit() or c == '.' for c in oid):
            resolved[name] = oid
            continue
        if not oid:
            continue
        parts = oid.strip().split()
        if len(parts) >= 2:
            parent = parts[0]
            tail = '.'.join(p for p in parts[1:] if p.strip())
            if parent in po_map and all(c.isdigit() or c == '.' for c in po_map[parent]):
                resolved[name] = po_map[parent] + '.' + tail
                continue
        resolved[name] = oid
    return resolved
