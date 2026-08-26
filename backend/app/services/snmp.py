"""统一 SNMP 服务 —— 收敛所有 SNMP IO 操作。

集中管理 SNMP GET / WALK / 系统探测三种原语:
- ``snmp_get``      单 OID GET(系统 snmpget 命令,优先尝试 oid.0 再 oid)。
- ``snmp_get_many`` 批量 GET(pysnmp,迁移自 snmp_collector._snmp_get_metrics)。
- ``snmp_walk``     表遍历(系统 snmpwalk 命令,迁移自 devices._snmp_walk_sync)。
- ``system_probe``  SNMP 系统信息探测(pysnmp,迁移自 scanner._snmp_probe)。

所有超时/重试统一取自 ``settings``;返回值归一化由 ``_coerce`` 处理。
各 router / service 不再各自维护 SNMP 封装。
"""
from typing import Callable, Optional

from loguru import logger

from ..config import settings

try:
    from pysnmp.hlapi.v3arch.asyncio import (
        SnmpEngine, CommunityData, UdpTransportTarget, ContextData,
        ObjectType, ObjectIdentity, get_cmd,
    )
    SNMP_AVAILABLE = True
except ImportError:
    SNMP_AVAILABLE = False

from ..utils.snmp_helpers import (
    SNMP_OID_SYSTEM,
    SNMP_OID_INTERFACES,
    detect_vendor,
    detect_device_type,
)

# ── 小工具 ──────────────────────────────────────────────────────────────


def _ver_flag(version: str) -> str:
    """SNMP version -> CLI flag (1/2c/3)."""
    return {"1": "1", "2c": "2c", "3": "3"}.get(version, "2c")


def _mp_model(version: str) -> int:
    """SNMP version -> pysnmp mpModel (v1=0, v2c=1)."""
    return 0 if version == "1" else 1


def _coerce(val):
    """归一化 pysnmp 返回值:bytes 解码、数字转 int、其余保留。"""
    try:
        if hasattr(val, "_value"):
            val = val._value
        if isinstance(val, bytes):
            val = val.decode("utf-8", errors="replace")
        s = str(val)
        if s.replace("-", "").replace(".", "").isdigit():
            return int(s)
        return val
    except Exception:
        return None


async def _build_target(host: str, port: int,
                        timeout: Optional[int] = None,
                        retries: Optional[int] = None):
    """构建 pysnmp UDP target(默认值取 settings)。"""
    return await UdpTransportTarget.create(
        (host, port),
        timeout=timeout if timeout is not None else settings.SNMP_TIMEOUT,
        retries=retries if retries is not None else settings.SNMP_RETRIES,
    )


def _build_community(community: str, version: str):
    """构建 pysnmp CommunityData。"""
    return CommunityData(community, mpModel=_mp_model(version))


# ═══ SNMP GET(单 OID,系统 snmpget) ═══


def snmp_get(host: str, oid: str, *, port: int = 161, community: str = "public",
             version: str = "2c") -> str:
    """同步单 OID GET。

    优先尝试 ``oid.0`` 再 ``oid``。命中返回解析值(字符串);失败返回描述性
    文本。阻塞同步,需在 ``asyncio.to_thread`` / 线程池中调用。
    迁移自 snmp_templates._snmp_get_safe,行为一致。
    """
    import subprocess
    try:
        ver = _ver_flag(version)
        for try_oid in (oid + ".0", oid):
            try:
                result = subprocess.run(
                    ["/usr/bin/snmpget", "-v", ver, "-c", community,
                     "-t", "2", "-r", "0", f"{host}:{port}", try_oid],
                    capture_output=True, text=True, timeout=4,
                )
                out = result.stdout.strip() or result.stderr.strip()
                if result.returncode == 0 and "No Such" not in out:
                    if "=" in out:
                        return out.split("=", 1)[1].strip().split(":", 1)[-1].strip()
                    return out[:200]
                if out and "No Such" not in out and "Timeout" not in out:
                    return out[:200]
            except subprocess.TimeoutExpired:
                continue
        return "No response"
    except FileNotFoundError:
        return "Err: snmpget not installed"
    except Exception as e:
        return f"Err: {str(e)[:100]}"


# ═══ SNMP GET(多 OID,pysnmp 批量) ═══


async def snmp_get_many(host: str, oid_map: dict, *, port: int = 161,
                        community: str = "public", version: str = "2c",
                        timeout: Optional[int] = None,
                        retries: Optional[int] = None) -> dict:
    """批量 GET ``{name: OID}`` -> ``{name: value}``。

    个别 OID 失败时跳过该键。迁移自 snmp_collector._snmp_get_metrics,行为一致。
    """
    result = {}
    if not SNMP_AVAILABLE or not oid_map:
        return result
    try:
        target = await _build_target(host, port, timeout, retries)
        oids = [ObjectType(ObjectIdentity(oid)) for oid in oid_map.values() if oid]
        if not oids:
            return result
        engine = SnmpEngine()
        cd = _build_community(community, version)
        error_indication, error_status, error_index, var_binds = await get_cmd(
            engine, cd, target, ContextData(), *oids
        )
        if error_indication:
            logger.debug(f"SNMP get_many failed for {host}: {error_indication}")
            return result
        for (name, oid), vb in zip(oid_map.items(), var_binds):
            try:
                val = vb[1]
                if hasattr(val, "_value"):
                    val = val._value
                if isinstance(val, bytes):
                    val = val.decode("utf-8", errors="replace")
                result[name] = int(val) if str(val).replace("-", "").replace(".", "").isdigit() else val
            except Exception:
                pass
    except Exception as e:
        logger.debug(f"SNMP get_many failed for {host}: {e}")
    return result


# ═══ SNMP WALK(系统 snmpwalk) ═══


def _snmp_walk_sync(host: str, port: int, community: str, version: str,
                    base_oid: str, max_results: int = 50) -> list[dict]:
    """同步 WALK 一个 OID 子树,返回 ``[{oid, value}]``(值截断 200 字符)。

    迁移自 devices._snmp_walk_sync,行为一致。
    """
    import subprocess
    results: list[dict] = []
    ver = _ver_flag(version)
    try:
        proc = subprocess.run(
            ["snmpwalk", "-v", ver, "-c", community, "-t", "3", "-r", "1",
             f"{host}:{port}", base_oid],
            capture_output=True, text=True, timeout=15,
        )
        if proc.returncode == 0:
            for line in proc.stdout.strip().split("\n"):
                line = line.strip()
                if not line:
                    continue
                parts = line.split("=", 1) if "=" in line else line.split(" ", 1)
                if len(parts) >= 2:
                    oid_str = parts[0].strip()
                    val_str = parts[1].strip()
                    if ":" in val_str:
                        val_str = val_str.split(":", 1)[-1].strip()
                    results.append({"oid": oid_str, "value": val_str[:200]})
    except Exception:
        pass
    return results[:max_results]


async def snmp_walk(host: str, base_oid: str, *, port: int = 161,
                    community: str = "public", version: str = "2c",
                    max_results: int = 50) -> list[dict]:
    """异步 WALK,返回 ``[{oid, value}]``。在线程池中执行同步命令。"""
    import asyncio
    try:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, _snmp_walk_sync, host, port, community, version, base_oid, max_results
        )
    except Exception as e:
        logger.debug(f"SNMP walk failed for {host}: {e}")
        return []


# ═══ SNMP 系统探测(pysnmp) ═══


async def system_probe(host: str, community: str = "public", *, port: int = 161,
                       version: str = "2c", timeout: Optional[int] = None,
                       retries: Optional[int] = None,
                       os_detector: Optional[Callable[[str], Optional[str]]] = None) -> Optional[dict]:
    """SNMP 系统信息探测,返回 vendor / device_type / os_type / sys_descr 等。

    ``os_detector`` 是 ``callable(sys_descr) -> os_type``,由调用方提供
    (例如 scanner 的 _detect_os_from_snmp)。失败返回 None。
    迁移自 scanner._snmp_probe,行为一致。
    """
    if not SNMP_AVAILABLE:
        return None
    try:
        target = await _build_target(host, port, timeout, retries)
        err, _, _, var_binds = await get_cmd(
            SnmpEngine(), _build_community(community, version), target, ContextData(),
            ObjectType(ObjectIdentity(SNMP_OID_SYSTEM["sysDescr"])),
            ObjectType(ObjectIdentity(SNMP_OID_SYSTEM["sysObjectID"])),
            ObjectType(ObjectIdentity(SNMP_OID_SYSTEM["sysName"])),
            ObjectType(ObjectIdentity(SNMP_OID_SYSTEM["sysLocation"])),
            ObjectType(ObjectIdentity(SNMP_OID_SYSTEM["sysContact"])),
        )
        if err:
            return None

        sys_descr = str(var_binds[0][1]) if len(var_binds) > 0 else ""
        sys_object_id = str(var_binds[1][1]) if len(var_binds) > 1 else ""
        sys_name = str(var_binds[2][1]) if len(var_binds) > 2 else ""
        sys_location = str(var_binds[3][1]) if len(var_binds) > 3 else ""
        sys_contact = str(var_binds[4][1]) if len(var_binds) > 4 else ""

        vendor = detect_vendor(sys_object_id)
        device_type = detect_device_type(vendor, sys_descr)
        os_type = os_detector(sys_descr) if os_detector else None

        # Interface count
        if_count = 0
        try:
            err2, _, _, vb2 = await get_cmd(
                SnmpEngine(), _build_community(community, version),
                await _build_target(host, port, 2, 1), ContextData(),
                ObjectType(ObjectIdentity(SNMP_OID_INTERFACES["if_number"])),
            )
            if not err2 and vb2:
                if_count = int(vb2[0][1])
        except Exception:
            pass

        return {
            "hostname": sys_name or None,
            "device_type": device_type,
            "vendor": vendor,
            "os_type": os_type,
            "sys_descr": sys_descr[:200] if sys_descr else None,
            "sys_location": sys_location or None,
            "sys_contact": sys_contact or None,
            "if_count": if_count,
        }
    except Exception as e:
        logger.debug(f"SNMP system probe failed for {host}: {e}")
        return None
