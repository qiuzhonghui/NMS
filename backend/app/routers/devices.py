"""Device management API routes."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update, func

from ..database import get_session
from ..models.device import Device
from ..models.device_template import DeviceModel, TemplateItem, MibFile
from ..models.metrics import DeviceInterface, InterfaceMetric, DeviceMetric
from ..services.snmp import snmp_get, snmp_walk
import re

# Zabbix IF-MIB key patterns → SNMP OID prefix mapping
_ZABBIX_IF_KEY_MAP = {
    'ifHCInOctets': '1.3.6.1.2.1.31.1.1.1.6',
    'ifHCOutOctets': '1.3.6.1.2.1.31.1.1.1.10',
    'ifHighSpeed': '1.3.6.1.2.1.31.1.1.1.15',
    'ifAlias': '1.3.6.1.2.1.31.1.1.1.18',
    'ifInOctets': '1.3.6.1.2.1.2.2.1.10',
    'ifOutOctets': '1.3.6.1.2.1.2.2.1.16',
    'ifInDiscards': '1.3.6.1.2.1.2.2.1.13',
    'ifOutDiscards': '1.3.6.1.2.1.2.2.1.19',
    'ifInErrors': '1.3.6.1.2.1.2.2.1.14',
    'ifOutErrors': '1.3.6.1.2.1.2.2.1.20',
    'ifOperStatus': '1.3.6.1.2.1.2.2.1.8',
    'ifAdminStatus': '1.3.6.1.2.1.2.2.1.7',
    'ifDescr': '1.3.6.1.2.1.2.2.1.2',
    'ifType': '1.3.6.1.2.1.2.2.1.3',
    'ifMtu': '1.3.6.1.2.1.2.2.1.4',
    'ifSpeed': '1.3.6.1.2.1.2.2.1.5',
    'ifPhysAddress': '1.3.6.1.2.1.2.2.1.6',
    'ifName': '1.3.6.1.2.1.31.1.1.1.1',
    'ifInMulticastPkts': '1.3.6.1.2.1.31.1.1.1.2',
    'ifOutMulticastPkts': '1.3.6.1.2.1.31.1.1.1.4',
    'ifInBroadcastPkts': '1.3.6.1.2.1.31.1.1.1.3',
    'ifOutBroadcastPkts': '1.3.6.1.2.1.31.1.1.1.5',
    'ifInUcastPkts': '1.3.6.1.2.1.31.1.1.1.7',
    'ifOutUcastPkts': '1.3.6.1.2.1.31.1.1.1.11',
    'ifCounterDiscontinuityTime': '1.3.6.1.2.1.31.1.1.1.19',
    'dot1dBasePortIfIndex': '1.3.6.1.2.1.17.1.4.1.2',
    'dot1dStpPortState': '1.3.6.1.2.1.17.2.15.1.3',
}
# Zabbix agent keys → SNMP OID fallback
_ZABBIX_AGENT_KEY_MAP = {
    # Memory (HOST-RESOURCES-MIB)
    'vm.memory.util': None,  # calculated: (total-free)/total*100 → use hrStorage
    'vm.memory.total': '1.3.6.1.2.1.25.2.3.1.5',  # hrStorageSize
    'vm.memory.used': '1.3.6.1.2.1.25.2.3.1.6',   # hrStorageUsed
    'vm.memory.free': None,  # calculated
    'vm.memory.pused': None,  # calculated
    # CPU (HOST-RESOURCES-MIB)
    'system.cpu.util': '1.3.6.1.2.1.25.3.3.1.2',  # hrProcessorLoad
    'system.cpu.load': '1.3.6.1.2.1.25.3.3.1.2',
    # Storage
    'vfs.fs.size': '1.3.6.1.2.1.25.2.3.1.5',  # hrStorageSize
    'vfs.fs.used': '1.3.6.1.2.1.25.2.3.1.6',  # hrStorageUsed
}

# Discovery OIDs for LLD
_DISCOVERY_OIDS = {
    'ifDescr': '1.3.6.1.2.1.2.2.1.2',
    'ifName': '1.3.6.1.2.1.31.1.1.1.1',
    'ifIndex': '1.3.6.1.2.1.2.2.1.1',
}


async def _discover_interfaces(ip, port, community, version) -> dict[int, str]:
    """发现交换机接口：walk ifDescr/ifName 返回 {index: name} 映射。"""
    mapping = {}
    # Try ifName first, fall back to ifDescr
    for oid in [_DISCOVERY_OIDS['ifName'], _DISCOVERY_OIDS['ifDescr']]:
        results = await snmp_walk(ip, oid, port=port, community=community, version=version, max_results=200)
        if results:
            for r in results:
                # Extract index from OID suffix (last number)
                idx_match = re.search(r'\.(\d+)$', r['oid'])
                if idx_match:
                    idx = int(idx_match.group(1))
                    mapping[idx] = r['value']
            if mapping:
                break
    return mapping


def _parse_zabbix_key(oid_or_key: str) -> dict:
    """解析 Zabbix 格式的 key，返回操作类型和参数。
    返回: {type: 'oid'|'get'|'walk'|'icmp'|'agent'|'skip', oid: str|None, walk_oids: list|None}
    """
    if not oid_or_key: return {'type': 'skip', 'oid': None}
    key = oid_or_key.strip()
    # 纯数字 OID
    if all(c.isdigit() or c == '.' for c in key):
        return {'type': 'oid', 'oid': key}
    # get[OID]
    m = re.match(r'get\[([\d.]+)\]', key)
    if m: return {'type': 'oid', 'oid': m.group(1)}
    # walk[OID1,OID2,...]
    m = re.match(r'walk\[([^\]]+)\]', key)
    if m:
        oids = [o.strip() for o in m.group(1).split(',') if o.strip()]
        if oids:
            # 检查是否是纯数字 OID
            valid = [o for o in oids if all(c.isdigit() or c == '.' for c in o)]
            if valid: return {'type': 'walk', 'oid': valid[0], 'walk_oids': valid}
    # icmpping, icmppingsec, icmppingloss
    if key.startswith('icmpping'):
        return {'type': 'icmp', 'oid': None}
    # net.if.*[key.{#SNMPINDEX}] - IF-MIB based LLD → walk with interface binding
    m = re.match(r'(net\.if\.\w+)\[(\w+)\.\{#SNMPINDEX\}\]', key)
    if m:
        zkey = m.group(2)
        if zkey in _ZABBIX_IF_KEY_MAP:
            return {'type': 'if_walk', 'oid': _ZABBIX_IF_KEY_MAP[zkey], 'zkey': zkey}
        return {'type': 'agent', 'oid': None}
    # Generic {#SNMPINDEX} pattern in key
    if '{#SNMPINDEX}' in key and 'walk[' not in key:
        return {'type': 'lld_discovery', 'oid': None}
    # system.xxx.key[OID_NAME.instance] — Zabbix key with OID name reference
    m = re.match(r'[\w.]+\[(\w+)\.(\d+)\]', key)
    if m:
        oid_name = m.group(1)
        instance = m.group(2)
        if oid_name in _ZABBIX_IF_KEY_MAP:
            return {'type': 'oid', 'oid': _ZABBIX_IF_KEY_MAP[oid_name] + '.' + instance}
        return {'type': 'oid_name', 'oid': None, 'oid_name': oid_name, 'instance': instance}
    # Agent keys with known SNMP OID mappings
    if key.replace('.','').replace('_','').isalpha() or re.match(r'^[a-zA-Z_.]+\[', key):
        # Extract base key name (e.g., vm.memory.util from vm.memory.util[...])
        base = key.split('[')[0] if '[' in key else key
        if base in _ZABBIX_AGENT_KEY_MAP:
            oid = _ZABBIX_AGENT_KEY_MAP[base]
            if oid:
                return {'type': 'oid', 'oid': oid}
        return {'type': 'agent', 'oid': None}
    # Try to extract any numeric OID from the string
    m = re.search(r'([\d]{1,3}\.[\d.]+)', key)
    if m: return {'type': 'oid', 'oid': m.group(1)}
    return {'type': 'skip', 'oid': None}


from ..websocket import ws_manager
from pydantic import BaseModel

router = APIRouter(prefix="/devices", tags=["devices"])


class DeviceUpdate(BaseModel):
    name: Optional[str] = None
    ip_address: Optional[str] = None
    device_type: Optional[str] = None
    vendor: Optional[str] = None
    model: Optional[str] = None
    model_id: Optional[str] = None
    snmp_enabled: Optional[bool] = None
    snmp_version: Optional[str] = None
    snmp_community: Optional[str] = None
    snmp_port: Optional[int] = None
    ssh_port: Optional[int] = None
    rdp_port: Optional[int] = None
    web_port: Optional[int] = None
    front_panel_id: Optional[str] = None
    tags: Optional[dict] = None
    protocol: Optional[str] = None
    template_id: Optional[str] = None
    snmp_template_id: Optional[str] = None
    mib_file_id: Optional[str] = None
    cisco_list_id: Optional[str] = None
    zabbix_template_id: Optional[str] = None
    agent_port: Optional[int] = None
    monitoring_interval: Optional[int] = None


class ManualAddDevice(BaseModel):
    """Manual device addition with protocol and model selection."""
    name: str
    ip_address: str
    protocol: str = "snmp"           # snmp / icmp / agent / web
    device_type: str = "other"
    model_id: Optional[str] = None
    template_id: Optional[str] = None
    vendor: Optional[str] = None
    model_name: Optional[str] = None
    snmp_version: str = "2c"
    snmp_community: str = "public"
    snmp_port: int = 161
    snmp_enabled: bool = True
    agent_port: int = 9090
    ssh_port: Optional[int] = None
    web_port: Optional[int] = None
    monitoring_interval: int = 60


@router.post("/manual-add")
async def manual_add_device(
    data: ManualAddDevice,
    session: AsyncSession = Depends(get_session),
):
    """Manually add a device with protocol, model, and template selection."""
    from loguru import logger

    # Check if device with same IP already exists
    existing = await session.execute(
        select(Device).where(Device.ip_address == data.ip_address)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail=f"Device with IP {data.ip_address} already exists"
        )

    device = Device(
        name=data.name,
        ip_address=data.ip_address,
        hostname=data.name,
        device_type=data.device_type,
        vendor=data.vendor,
        model=data.model_name,
        protocol=data.protocol,
        model_id=data.model_id,
        template_id=data.template_id,
        snmp_enabled=data.snmp_enabled and data.protocol in ("snmp",),
        snmp_version=data.snmp_version,
        snmp_community=data.snmp_community,
        snmp_port=data.snmp_port,
        agent_port=data.agent_port,
        ssh_port=data.ssh_port or (22 if data.device_type in ("router","switch","server_linux") else None),
        web_port=data.web_port or (80 if data.protocol == "web" else None),
        monitoring_interval=data.monitoring_interval,
        status="unknown",
    )
    session.add(device)
    await session.commit()
    await session.refresh(device)

    # Auto-apply template items if a template was selected
    if data.template_id:
        from ..models.device_template import TemplateItem
        items = await session.execute(
            select(TemplateItem).where(
                TemplateItem.template_id == data.template_id,
                TemplateItem.enabled == True,
            )
        )
        items = items.scalars().all()
        logger.info(
            f"Manual-add device {data.name} ({data.ip_address}) "
            f"protocol={data.protocol} template={data.template_id} "
            f"with {len(items)} monitoring items"
        )

    await ws_manager.broadcast("device_added", {
        "device_id": device.id, "name": device.name,
        "ip_address": device.ip_address, "protocol": device.protocol,
    })

    return {"id": device.id, "name": device.name, "status": "added"}


@router.get("")
async def list_devices(
    device_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: Optional[int] = Query(None, ge=1, le=1000),
    offset: Optional[int] = Query(None, ge=0),
    session: AsyncSession = Depends(get_session),
):
    """List all managed devices with optional filters.

    `limit` / `offset` are optional: when omitted, the full list is returned
    (legacy behavior), so existing frontend callers are unaffected.
    """
    stmt = select(Device)

    if device_type:
        stmt = stmt.where(Device.device_type == device_type)
    if status:
        stmt = stmt.where(Device.status == status)
    if search:
        stmt = stmt.where(
            (Device.name.contains(search)) |
            (Device.ip_address.contains(search)) |
            (Device.hostname.contains(search))
        )

    stmt = stmt.order_by(Device.name)
    if limit is not None:
        stmt = stmt.limit(limit)
    if offset is not None:
        stmt = stmt.offset(offset)
    result = await session.execute(stmt)
    devices = result.scalars().all()

    # Fetch latest ICMP metrics for all devices in a single query (avoids N+1)
    device_ids = [d.id for d in devices]
    icmp_data: dict[str, dict] = {}
    if device_ids:
        latest_subq = (
            select(
                DeviceMetric.device_id.label("did"),
                DeviceMetric.metric_name.label("mname"),
                func.max(DeviceMetric.collected_at).label("max_ts"),
            )
            .where(
                DeviceMetric.device_id.in_(device_ids),
                DeviceMetric.metric_name.in_(["icmp_latency_ms", "icmp_reachable"]),
            )
            .group_by(DeviceMetric.device_id, DeviceMetric.metric_name)
            .subquery()
        )
        rows = await session.execute(
            select(
                DeviceMetric.device_id,
                DeviceMetric.metric_name,
                DeviceMetric.value,
            )
            .join(
                latest_subq,
                (DeviceMetric.device_id == latest_subq.c.did)
                & (DeviceMetric.metric_name == latest_subq.c.mname)
                & (DeviceMetric.collected_at == latest_subq.c.max_ts),
            )
        )
        for did, mname, value in rows.all():
            entry = icmp_data.setdefault(did, {})
            if mname == "icmp_latency_ms":
                entry["latency_ms"] = value
            else:
                entry["reachable"] = value

    return [
        {
            "id": d.id,
            "name": d.name,
            "ip_address": d.ip_address,
            "device_type": d.device_type,
            "vendor": d.vendor,
            "model": d.model,
            "hostname": d.hostname,
            "status": d.status,
            "protocol": d.protocol,
            "snmp_enabled": d.snmp_enabled,
            "last_seen": d.last_seen.isoformat() if d.last_seen else None,
            "icmp_latency_ms": icmp_data.get(d.id, {}).get("latency_ms"),
            "icmp_reachable": icmp_data.get(d.id, {}).get("reachable"),
            "tags": d.tags,
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "ssh_port": d.ssh_port,
            "rdp_port": d.rdp_port,
            "web_port": d.web_port,
        }
        for d in devices
    ]


@router.get("/{device_id}")
async def get_device(
    device_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Get detailed information about a specific device."""
    result = await session.execute(
        select(Device).where(Device.id == device_id)
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    # Fetch latest ICMP metrics
    from sqlalchemy import desc
    latency = await session.execute(
        select(DeviceMetric)
        .where(DeviceMetric.device_id == device_id, DeviceMetric.metric_name == "icmp_latency_ms")
        .order_by(desc(DeviceMetric.collected_at)).limit(1)
    )
    icmp_lat = latency.scalar_one_or_none()
    reachable = await session.execute(
        select(DeviceMetric)
        .where(DeviceMetric.device_id == device_id, DeviceMetric.metric_name == "icmp_reachable")
        .order_by(desc(DeviceMetric.collected_at)).limit(1)
    )
    icmp_up = reachable.scalar_one_or_none()

    return {
        "id": device.id,
        "name": device.name,
        "ip_address": device.ip_address,
        "device_type": device.device_type,
        "vendor": device.vendor,
        "model": device.model,
        "model_id": device.model_id,
        "hostname": device.hostname,
        "status": device.status,
        "protocol": device.protocol,
        "icmp_latency_ms": icmp_lat.value if icmp_lat else None,
        "icmp_reachable": icmp_up.value if icmp_up else None,
        "snmp_enabled": device.snmp_enabled,
        "snmp_version": device.snmp_version,
        "snmp_community": device.snmp_community,
        "snmp_port": device.snmp_port,
        "ssh_port": device.ssh_port,
        "rdp_port": device.rdp_port,
        "web_port": device.web_port,
        "template_id": device.template_id,
        "snmp_template_id": device.snmp_template_id,
        "mib_file_id": device.mib_file_id,
        "cisco_list_id": device.cisco_list_id,
        "zabbix_template_id": device.zabbix_template_id,
        "last_seen": device.last_seen.isoformat() if device.last_seen else None,
        "tags": device.tags,
        "front_panel_id": device.front_panel_id,
        "created_at": device.created_at.isoformat() if device.created_at else None,
        "updated_at": device.updated_at.isoformat() if device.updated_at else None,
    }


@router.put("/{device_id}")
async def update_device(
    device_id: str,
    data: DeviceUpdate,
    session: AsyncSession = Depends(get_session),
):
    """Update a device's configuration."""
    result = await session.execute(
        select(Device).where(Device.id == device_id)
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(device, key, value)

    await session.commit()
    await session.refresh(device)

    return {"id": device.id, "status": "updated"}


@router.delete("/{device_id}")
async def delete_device(
    device_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Remove a device from management."""
    result = await session.execute(
        select(Device).where(Device.id == device_id)
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    await session.delete(device)
    await session.commit()

    await ws_manager.broadcast("device_removed", {"device_id": device_id})
    return {"status": "deleted"}


@router.get("/{device_id}/metrics")
async def get_device_metrics(
    device_id: str,
    metric_type: Optional[str] = Query(None),
    metric_name: Optional[str] = Query(None),
    from_time: Optional[str] = Query(None),
    to_time: Optional[str] = Query(None),
    limit: int = Query(100, le=1000),
    session: AsyncSession = Depends(get_session),
):
    """Get historical metrics for a device."""
    stmt = select(DeviceMetric).where(
        DeviceMetric.device_id == device_id
    )

    if metric_type:
        stmt = stmt.where(DeviceMetric.metric_type == metric_type)
    if metric_name:
        stmt = stmt.where(DeviceMetric.metric_name == metric_name)
    if from_time:
        stmt = stmt.where(DeviceMetric.collected_at >= from_time)
    if to_time:
        stmt = stmt.where(DeviceMetric.collected_at <= to_time)

    stmt = stmt.order_by(DeviceMetric.collected_at.desc()).limit(limit)
    result = await session.execute(stmt)
    metrics = result.scalars().all()

    return [
        {
            "id": m.id,
            "metric_type": m.metric_type,
            "metric_name": m.metric_name,
            "value": m.value,
            "unit": m.unit,
            "collected_at": m.collected_at.isoformat() if m.collected_at else None,
        }
        for m in metrics
    ]


@router.get("/{device_id}/live-template-data")
async def live_template_data(
    device_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Get live SNMP data for the device's model template items."""
    result = await session.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device: raise HTTPException(404, "Device not found")
    if not device.snmp_enabled: raise HTTPException(400, "SNMP not enabled")

    # Find template from device model (support all template types)
    items = []
    if device.model_id:
        model_result = await session.execute(select(DeviceModel).where(DeviceModel.id == device.model_id))
        model = model_result.scalar_one_or_none()
        if model and model.template_type and model.template_ref_id:
            # For snmp/zabbix types, items are stored in TemplateItem
            if model.template_type in ('snmp', 'zabbix'):
                tmpl_result = await session.execute(
                    select(TemplateItem).where(TemplateItem.template_id == model.template_ref_id)
                )
                items = tmpl_result.scalars().all()
            elif model.template_type == 'mib':
                # Load OIDs from MibFile
                mf = await session.get(MibFile, model.template_ref_id)
                if mf and mf.parsed_oids:
                    for o in mf.parsed_oids:
                        items.append(type('Item',(),{'metric_name': o.get('name',''), 'oid_or_key': o.get('oid',''), 'unit': '', 'display_type': 'text'})())
            elif model.template_type == 'cisco':
                # Load OIDs from Cisco list MibFile
                mf = await session.get(MibFile, model.template_ref_id)
                if mf and mf.parsed_oids:
                    for o in mf.parsed_oids:
                        items.append(type('Item',(),{'metric_name': o.get('name',''), 'oid_or_key': o.get('oid',''), 'unit': '', 'display_type': 'text'})())

    if not items:
        return {"device_id": device_id, "items": [], "message": "No template items found"}

    # Live SNMP/ICMP query for each item
    import asyncio as aio
    results = []
    # Discover interfaces once for LLD items
    if_map = {}
    needs_if_discovery = any('{#SNMPINDEX}' in (getattr(it, 'oid_or_key', '') or '') for it in items)
    if needs_if_discovery:
        if_map = await _discover_interfaces(
            device.ip_address, device.snmp_port or 161,
            device.snmp_community or 'public', device.snmp_version or '2c'
        )

    for item in items:
        raw_key = item.oid_or_key if hasattr(item, 'oid_or_key') else getattr(item, 'oid_or_key', '')
        parsed = _parse_zabbix_key(raw_key or '')
        ptype = parsed['type']

        if ptype == 'icmp':
            # ICMP ping
            import subprocess
            try:
                proc = subprocess.run(["ping", "-c", "1", "-W", "2", device.ip_address],
                    capture_output=True, text=True, timeout=3)
                if proc.returncode == 0:
                    # Extract time
                    tm = re.search(r'time[=<](\d+\.?\d*)', proc.stdout)
                    val = (tm.group(1) if tm else "reachable") + " ms"
                else:
                    val = "unreachable"
            except Exception:
                val = "ICMP error"
            results.append({
                "metric_name": item.metric_name, "oid": raw_key,
                "value": val, "unit": "ms", "display_type": "text"
            })

        elif ptype == 'walk':
            # SNMP walk
            walk_results = await snmp_walk(
                device.ip_address, parsed['oid'],
                port=device.snmp_port or 161,
                community=device.snmp_community or 'public',
                version=device.snmp_version or '2c',
                max_results=50,
            )
            if walk_results:
                # First result as summary
                results.append({
                    "metric_name": item.metric_name, "oid": parsed['oid'],
                    "value": f"{len(walk_results)} entries", "unit": item.unit or "",
                    "display_type": "table", "walk_results": walk_results
                })
            else:
                results.append({
                    "metric_name": item.metric_name, "oid": parsed['oid'],
                    "value": "Walk returned no results", "unit": item.unit or "",
                    "display_type": "table"
                })

        elif ptype == 'if_walk':
            # Walk the OID and bind each value to interface name
            walk_results = await snmp_walk(
                device.ip_address, parsed['oid'],
                port=device.snmp_port or 161,
                community=device.snmp_community or 'public',
                version=device.snmp_version or '2c',
                max_results=200,
            )
            if walk_results and if_map:
                # Bind each walk result to an interface name
                bound = []
                for wr in walk_results:
                    idx_match = re.search(r'\.(\d+)$', wr['oid'])
                    if idx_match:
                        idx = int(idx_match.group(1))
                        if_name = if_map.get(idx, f'ifIndex.{idx}')
                        bound.append({"port": if_name, "index": idx, "value": wr['value']})
                results.append({
                    "metric_name": item.metric_name, "oid": parsed['oid'],
                    "value": f"{len(bound)} ports", "unit": item.unit or "",
                    "display_type": "table", "walk_results": [
                        {"oid": f"{b['port']} (idx {b['index']})", "value": b['value']}
                        for b in bound
                    ] if bound else walk_results
                })
            elif walk_results:
                results.append({
                    "metric_name": item.metric_name, "oid": parsed['oid'],
                    "value": f"{len(walk_results)} entries", "unit": item.unit or "",
                    "display_type": "table", "walk_results": walk_results
                })
            else:
                results.append({
                    "metric_name": item.metric_name, "oid": parsed['oid'],
                    "value": "No data", "unit": item.unit or "", "display_type": "table"
                })

        elif ptype in ('oid', 'get'):
            # Single SNMP GET
            oid = parsed['oid']
            try:
                val = await aio.to_thread(
                    snmp_get, device.ip_address, oid,
                    port=device.snmp_port or 161,
                    community=device.snmp_community or 'public',
                    version=device.snmp_version or '2c',
                )
            except Exception as e:
                val = f"Err: {str(e)[:80]}"
            results.append({
                "metric_name": item.metric_name, "oid": oid,
                "value": str(val)[:200], "unit": item.unit or "",
                "display_type": item.display_type or "chart"
            })

        else:
            # Agent key or skip
            results.append({
                "metric_name": item.metric_name, "oid": raw_key or '-',
                "value": "(agent key, not SNMP)", "unit": item.unit or "",
                "display_type": item.display_type or "text"
            })

    return {"device_id": device_id, "items": results}


@router.get("/{device_id}/interfaces")
async def get_device_interfaces(
    device_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Get all network interfaces for a device."""
    result = await session.execute(
        select(DeviceInterface)
        .where(DeviceInterface.device_id == device_id)
        .order_by(DeviceInterface.if_index)
    )
    interfaces = result.scalars().all()

    return [
        {
            "id": iface.id,
            "name": iface.name,
            "if_index": iface.if_index,
            "if_type": iface.if_type,
            "mac_address": iface.mac_address,
            "speed": iface.speed,
            "status": iface.status,
            "alias": iface.alias,
            "last_change": iface.last_change.isoformat() if iface.last_change else None,
        }
        for iface in interfaces
    ]
