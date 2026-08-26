"""内置 OID 描述 / MIB 模块名映射 —— 供 SNMP 模板与 MIB 管理共用。

从 snmp_templates.py 迁出,避免 router 之间互相 import 私有函数。
"""

# ── 内置 OID 描述字典 (中/英) ──────────────────────────────────────────────
OID_DESCRIPTIONS: dict[str, tuple[str, str]] = {
    "1.3.6.1.2.1.1.1": ("系统描述", "System description"),
    "1.3.6.1.2.1.1.3": ("系统运行时间", "System uptime"),
    "1.3.6.1.2.1.1.5": ("系统主机名", "System hostname"),
    "1.3.6.1.2.1.2.2.1.2": ("接口描述", "Interface description"),
    "1.3.6.1.2.1.2.2.1.5": ("接口速率", "Interface speed"),
    "1.3.6.1.2.1.2.2.1.8": ("接口运行状态", "Interface operational status"),
    "1.3.6.1.2.1.2.2.1.10": ("接口入流量", "Interface input octets"),
    "1.3.6.1.2.1.2.2.1.16": ("接口出流量", "Interface output octets"),
    "1.3.6.1.2.1.4.20": ("IP 路由表", "IP route table"),
    "1.3.6.1.2.1.4.22": ("ARP 表", "ARP table"),
    "1.3.6.1.2.1.25.2.3.1.5": ("磁盘总量", "Disk total size"),
    "1.3.6.1.2.1.25.2.3.1.6": ("磁盘已用", "Disk used"),
    "1.3.6.1.4.1.9.2.1.58": ("Cisco CPU 5秒负载", "Cisco CPU 5sec load"),
    "1.3.6.1.4.1.9.9.48.1.1.1.5": ("Cisco 内存总量", "Cisco memory total"),
    "1.3.6.1.4.1.9.9.48.1.1.1.6": ("Cisco 内存已用", "Cisco memory used"),
    "1.3.6.1.4.1.9.9.109.1.1.1.1.5": ("Cisco CPU 使用率", "Cisco CPU usage pct"),
    "1.3.6.1.4.1.9.9.13.1.3.1.3": ("Cisco 温度传感器", "Cisco temperature sensor"),
    "1.3.6.1.4.1.9.9.13.1.4.1.3": ("Cisco 风扇状态", "Cisco fan status"),
    "1.3.6.1.4.1.2021.4.5": ("内存总量", "Total memory"),
    "1.3.6.1.4.1.2021.4.6": ("可用内存", "Available memory"),
    "1.3.6.1.4.1.2021.11.50": ("CPU 用户态", "CPU user"),
    "1.3.6.1.4.1.2021.11.52": ("CPU 系统态", "CPU system"),
    "1.3.6.1.4.1.2021.11.53": ("CPU 空闲", "CPU idle"),
}


def _lookup_oid_desc(oid: str, name: str) -> tuple[str | None, str | None]:
    """根据 OID 前缀查找中英文描述。"""
    # 精确匹配
    if oid in OID_DESCRIPTIONS:
        return OID_DESCRIPTIONS[oid]
    # 前缀匹配
    parts = oid.split(".")
    for i in range(len(parts), 2, -1):
        prefix = ".".join(parts[:i])
        if prefix in OID_DESCRIPTIONS:
            return OID_DESCRIPTIONS[prefix]
    return None, None


# ── 常见 MIB 模块名 → OID 前缀映射(用于解析 system.1 这类名称) ────────────
MIB_MODULE_OIDS: dict[str, str] = {
    "system": "1.3.6.1.2.1.1",
    "interfaces": "1.3.6.1.2.1.2",
    "at": "1.3.6.1.2.1.3",
    "ip": "1.3.6.1.2.1.4",
    "icmp": "1.3.6.1.2.1.5",
    "tcp": "1.3.6.1.2.1.6",
    "udp": "1.3.6.1.2.1.7",
    "egp": "1.3.6.1.2.1.8",
    "transmission": "1.3.6.1.2.1.10",
    "snmp": "1.3.6.1.2.1.11",
    "host": "1.3.6.1.2.1.25",
    "hr": "1.3.6.1.2.1.25",
    "ifMIB": "1.3.6.1.2.1.31",
    "if": "1.3.6.1.2.1.31",
    "mib-2": "1.3.6.1.2.1",
    "mgmt": "1.3.6.1.2",
    "internet": "1.3.6.1",
    "private": "1.3.6.1.4",
    "enterprises": "1.3.6.1.4.1",
    "ciscoMgmt": "1.3.6.1.4.1.9.9",
    "ciscoEnvMon": "1.3.6.1.4.1.9.9.13",
    "ciscoFlash": "1.3.6.1.4.1.9.9.10",
    "ciscoMemory": "1.3.6.1.4.1.9.9.48",
    "ciscoProcess": "1.3.6.1.4.1.9.9.109",
    "ciscoImage": "1.3.6.1.4.1.9.9.25",
    "ciscoConfig": "1.3.6.1.4.1.9.9.43",
    "oldCisco": "1.3.6.1.4.1.9.2",
    "local": "1.3.6.1.4.1.9.2.2",
    "lc": "1.3.6.1.4.1.9.2.2",
}
# 也加入不区分大小写的版本
MIB_MODULE_OIDS.update({k.lower(): v for k, v in list(MIB_MODULE_OIDS.items())})
