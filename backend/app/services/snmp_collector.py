"""SNMP metric collection service — periodically polls devices for metrics."""
import asyncio
from datetime import datetime
from typing import Any, Dict, Optional, Set

from loguru import logger
from sqlalchemy import select

from ..config import settings
from ..database import async_session_factory
from ..models.device import Device
from ..models.device_template import DeviceModel, TemplateItem
from ..models.metrics import DeviceMetric
from ..utils.snmp_helpers import SNMP_OID_CPU, SNMP_OID_MEMORY
from ..utils.snmp_profiles import get_profile
from ..services.snmp import SNMP_AVAILABLE, snmp_get_many
from ..websocket import ws_manager

# Track running collection tasks by device_id
_collector_tasks: Dict[str, asyncio.Task] = {}
_running = False

async def start_collector() -> None:
    """Start the SNMP collector background service."""
    global _running
    if not SNMP_AVAILABLE:
        logger.warning("SNMP collector disabled — pysnmp not installed")
        return
    _running = True
    asyncio.create_task(_collection_loop())
    logger.info("SNMP collector started")

async def stop_collector() -> None:
    """Stop the SNMP collector."""
    global _running
    _running = False
    for task in _collector_tasks.values():
        task.cancel()
    _collector_tasks.clear()
    logger.info("SNMP collector stopped")

async def _collection_loop() -> None:
    """Main loop: finds SNMP-enabled devices and schedules collection."""
    logger.info("SNMP collection loop started")
    while _running:
        try:
            async with async_session_factory() as session:
                result = await session.execute(
                    select(Device).where(
                        Device.snmp_enabled == True,
                        Device.status != "offline",
                    )
                )
                devices = result.scalars().all()

                for device in devices:
                    if device.id not in _collector_tasks:
                        task = asyncio.create_task(
                            _collect_device_metrics(device.id, device.ip_address,
                                                    device.snmp_community or "public",
                                                    device.snmp_version)
                        )
                        _collector_tasks[device.id] = task

                # Clean up tasks for removed/disabled devices
                active_ids = {d.id for d in devices}
                for did in list(_collector_tasks.keys()):
                    if did not in active_ids:
                        _collector_tasks[did].cancel()
                        del _collector_tasks[did]

        except Exception as e:
            pass
            logger.error(f"Collection loop error: {e}")

        await asyncio.sleep(settings.METRICS_COLLECTION_INTERVAL)

async def _collect_device_metrics(
    device_id: str, ip: str, community: str, version: str
) -> None:
    """Collect metrics from a single device."""
    try:
        async with async_session_factory() as session:
            result = await session.execute(select(Device).where(Device.id == device_id))
            device = result.scalar_one_or_none()
            profile_oid = None
            profile_name = None
            if device:
                if device.model_id:
                    model_result = await session.execute(
                        select(DeviceModel).where(DeviceModel.id == device.model_id)
                    )
                    model = model_result.scalar_one_or_none()
                    if model and model.snmp_profile:
                        profile_oid = get_profile(model.snmp_profile)
                        profile_name = model.snmp_profile
                if not profile_oid and device.vendor:
                    vendor_lower = device.vendor.lower()
                    for name in ["cisco_ios", "huawei_vrp", "h3c_comware", "fortinet_fortios",
                                 "juniper_junos", "mikrotik_ros", "linux_generic", "windows_generic"]:
                        p = get_profile(name)
                        if p and p.get("vendor","").lower() in vendor_lower:
                            profile_oid = p; profile_name = name; break

                # Collect template item OIDs if device has a monitoring template assigned
                template_items_oids = {}
                if device and device.template_id:
                    items_result = await session.execute(
                        select(TemplateItem).where(
                            TemplateItem.template_id == device.template_id,
                            TemplateItem.enabled == True,
                            TemplateItem.protocol == "snmp",
                            TemplateItem.oid_or_key.isnot(None),
                        )
                    )
                    for item in items_result.scalars().all():
                        oid = (item.oid_or_key or "").strip()
                        if oid:
                            template_items_oids[item.metric_name] = oid

            # TEST: query standard sysDescr first
            test_oid = {"sysDescr": "1.3.6.1.2.1.1.1.0"}
            test_result = await snmp_get_many(ip, test_oid, community=community, version=version, port=161)

            all_metrics = {}
            if profile_oid and test_result:
                for cat, oids in profile_oid.get("metrics", {}).items():
                    if cat == "tables": continue
                    r = await snmp_get_many(ip, oids, community=community, version=version, port=161)
                    if r: all_metrics.update(r)
            elif test_result:
                all_metrics = await snmp_get_many(ip, SNMP_OID_CPU, community=community, version=version, port=161)
                all_metrics.update(await snmp_get_many(ip, SNMP_OID_MEMORY, community=community, version=version, port=161))

            # Poll template item OIDs (from imported/monitoring templates)
            if template_items_oids:
                template_results = await snmp_get_many(
                    ip, template_items_oids, community=community, version=version, port=161
                )
                if template_results:
                    all_metrics.update(template_results)

            now = datetime.utcnow()

            for name, value in all_metrics.items():
                if value is not None and value != '' and value != "":
                    try:
                        v = float(value)
                        mtype = "cpu" if "cpu" in name else "memory" if "mem" in name else name.split("_")[0]
                        unit = "%" if "cpu" in name or "usage" in name else "KB"
                        session.add(DeviceMetric(
                            device_id=device_id, metric_type=mtype, metric_name=name,
                            value=v, unit=unit, collected_at=now,
                        ))
                        # Compute dashboard-friendly usage pct
                        if name == "cpu_5sec":
                            session.add(DeviceMetric(device_id=device_id, metric_type="cpu",
                                metric_name="cpu_usage_pct", value=v, unit="%", collected_at=now))
                        if name == "mem_used" and "mem_total" in all_metrics:
                            total = float(all_metrics.get("mem_total", 1))
                            if total > 0:
                                session.add(DeviceMetric(device_id=device_id, metric_type="memory",
                                    metric_name="mem_usage_pct", value=round(v/total*100,1), unit="%", collected_at=now))
                    except (ValueError, TypeError): pass

            # Collect interface metrics
            iface_data = await snmp_get_many(
                ip, {"if_in_octets": "1.3.6.1.2.1.2.2.1.10.1", "if_out_octets": "1.3.6.1.2.1.2.2.1.16.1"},
                community=community, version=version, port=161,
            )
            for iname, ival in iface_data.items():
                if ival and ival!="" and ival!=0:
                    try:
                        session.add(DeviceMetric(device_id=device_id, metric_type="network", metric_name=iname, value=float(ival), unit="octets", collected_at=now))
                    except: pass
            # Skip interfaces — focus on CPU/memory metrics

            await session.commit()

            # Push real-time metrics via WebSocket
            await ws_manager.broadcast_to_subscribers(device_id, "metric_update", {
                "metrics": [
                    {"metric_type": "cpu" if "cpu" in k else "memory" if "mem" in k else k.split("_")[0],
                     "metric_name": k, "value": v}
                    for k, v in all_metrics.items() if v is not None and v != ""
                ],
                "timestamp": now.isoformat(),
            })

            # Update device status
            device_result = await session.execute(
                select(Device).where(Device.id == device_id)
            )
            device = device_result.scalar_one_or_none()
            if device:
                device.status = "online"
                device.last_seen = now
                await session.commit()

    except asyncio.CancelledError:
        pass
        raise
    except Exception as e:
        # Mark device as potentially offline
        async with async_session_factory() as session:
            result = await session.execute(
                select(Device).where(Device.id == device_id)
            )
            device = result.scalar_one_or_none()
            if device:
                device.status = "warning"
                await session.commit()

        await ws_manager.broadcast_to_subscribers(device_id, "device_status", {
            "status": "warning",
        })

