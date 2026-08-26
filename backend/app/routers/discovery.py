"""Network discovery API routes."""
import asyncio
import uuid
import traceback
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel
from loguru import logger

from ..database import get_session
from ..models.device import DiscoveredDevice, Device
from ..models.metrics import DeviceInterface
from ..services.scanner import NetworkScanner
from ..websocket import ws_manager

router = APIRouter(prefix="/discovery", tags=["discovery"])


class ScanRequest(BaseModel):
    ranges: list[str]
    snmp_communities: list[str] = ["public"]
    scan_type: str = "both"
    concurrency: int = 50


class ScanProgress:
    """Track scan progress in memory."""

    def __init__(self) -> None:
        self._scans: dict[str, dict] = {}

    def create(self, scan_id: str) -> None:
        self._scans[scan_id] = {"progress": 0, "total": 0, "found": 0, "status": "running"}

    def update(self, scan_id: str, **kwargs) -> None:
        if scan_id in self._scans:
            self._scans[scan_id].update(kwargs)

    def get(self, scan_id: str) -> Optional[dict]:
        return self._scans.get(scan_id)


scan_progress_tracker = ScanProgress()
_active_scans: dict[str, asyncio.Task] = {}


@router.post("/scan")
async def start_scan(req: ScanRequest):
    """Start a network discovery scan."""
    scan_id = uuid.uuid4().hex[:16]
    scan_progress_tracker.create(scan_id)
    task = asyncio.create_task(_run_scan(scan_id, req))
    _active_scans[scan_id] = task
    return {"scan_id": scan_id, "status": "started"}


@router.post("/scan/{scan_id}/stop")
async def stop_scan(scan_id: str):
    """Stop a running scan."""
    task = _active_scans.get(scan_id)
    if task and not task.done():
        task.cancel()
        scan_progress_tracker.update(scan_id, status="stopped")
        await ws_manager.broadcast("scan_stopped", {"scan_id": scan_id})
        return {"status": "stopped"}
    return {"status": "not_found"}


async def _deep_probe_and_update(device_id: str, ip: str) -> None:
    """Background task: deeply probe a device and update its record + push to frontend."""
    from ..database import async_session_factory
    try:
        scanner = NetworkScanner(snmp_communities=["public", "private"], concurrency=1)
        detailed = await scanner._scan_single(ip)
        if detailed:
            async with async_session_factory() as session:
                dd = await session.get(DiscoveredDevice, device_id)
                if dd:
                    if detailed.get("hostname"): dd.hostname = detailed["hostname"]
                    if detailed.get("device_type"): dd.device_type = detailed["device_type"]
                    if detailed.get("vendor"): dd.vendor = detailed["vendor"]
                    if detailed.get("mac_address"): dd.mac_address = detailed["mac_address"]
                    if detailed.get("os_type"): dd.os_type = detailed["os_type"]
                    dd.snmp_available = detailed.get("snmp_available", False)
                    if detailed.get("open_ports"):
                        dd.open_ports = ",".join(str(p) for p in detailed["open_ports"])
                    await session.commit()
                    await ws_manager.broadcast("scan_device_found", {
                        "scan_id": "bg",
                        "device": {
                            "id": dd.id, "ip_address": dd.ip_address,
                            "hostname": dd.hostname, "device_type": dd.device_type,
                            "vendor": dd.vendor, "mac_address": dd.mac_address,
                            "os_type": dd.os_type, "snmp_available": dd.snmp_available,
                            "icmp_reachable": dd.icmp_reachable,
                            "discovered_at": dd.discovered_at.isoformat() if dd.discovered_at else None,
                            "approved": dd.approved, "_loading": False,
                        },
                    })
    except Exception: pass


async def _run_scan(scan_id: str, req: ScanRequest) -> None:
    """Single-pass scan with real-time WebSocket updates as data comes in."""
    from ..utils.cidr import parse_network_ranges
    from ..database import async_session_factory

    targets = parse_network_ranges(req.ranges)
    total = len(targets)
    scan_progress_tracker.update(scan_id, total=total, scanned=0, found=0, progress=0, status="scanning")

    scanner = NetworkScanner(snmp_communities=req.snmp_communities, concurrency=req.concurrency)

    scanned_count = 0
    found_count = 0

    # Helper: broadcast a device update to frontend
    def _push_device(dd: DiscoveredDevice, loading: bool = False):
        return ws_manager.broadcast("scan_device_found", {
            "scan_id": scan_id, "device": {
                "id": dd.id, "ip_address": dd.ip_address,
                "hostname": dd.hostname, "device_type": dd.device_type,
                "vendor": dd.vendor, "mac_address": dd.mac_address,
                "os_type": dd.os_type, "snmp_available": dd.snmp_available,
                "icmp_reachable": dd.icmp_reachable,
                "discovered_at": dd.discovered_at.isoformat() if dd.discovered_at else None,
                "approved": dd.approved, "_loading": loading,
            },
        })

    try:
        async for result in scanner.scan_async(targets):
            scanned_count += 1
            pct = int(scanned_count / max(total, 1) * 100)
            ip = result["ip_address"]
            scan_progress_tracker.update(scan_id, scanned=scanned_count, found=found_count, total=total, progress=pct)

            # Send tool status
            tool = "PING" if result.get("_dead") else ("SNMP" if result.get("snmp_available") else "ICMP")
            await ws_manager.broadcast("scan_tool", {"scan_id": scan_id, "ip": ip, "tool": tool})

            if result.get("_dead"):
                await ws_manager.broadcast("scan_progress", {
                    "scan_id": scan_id, "progress": pct, "found": found_count,
                    "scanned": scanned_count, "total": total,
                })
                continue

            async with async_session_factory() as session:
                existing = await session.execute(
                    select(DiscoveredDevice).where(DiscoveredDevice.ip_address == result["ip_address"])
                )
                if existing.scalar_one_or_none(): continue

                # Check if already managed
                existing_dev = await session.execute(
                    select(Device).where(Device.ip_address == result["ip_address"])
                )
                managed_device = existing_dev.scalar_one_or_none()

                found_count += 1
                # Determine if data is complete or still loading
                has_details = bool(result.get("vendor") or result.get("os_type") or result.get("mac_address"))
                loading = not has_details

                dd = DiscoveredDevice(
                    ip_address=result["ip_address"], icmp_reachable=result.get("icmp_reachable", False),
                    hostname=result.get("hostname"), device_type=result.get("device_type"),
                    vendor=result.get("vendor"), mac_address=result.get("mac_address"),
                    os_type=result.get("os_type"), snmp_available=result.get("snmp_available", False),
                    snmp_community=result.get("snmp_community"),
                    discovery_method=result.get("discovery_method", "icmp"),
                    approved=managed_device is not None,
                    approved_device_id=managed_device.id if managed_device else None,
                )
                session.add(dd)
                await session.commit()
                scan_progress_tracker.update(scan_id, found=found_count)

                # Send to frontend immediately — with or without details
                await _push_device(dd, loading=loading)

                # If details are missing, do a deeper probe and update (in background task)
                if loading:
                    asyncio.create_task(_deep_probe_and_update(dd.id, result["ip_address"]))

            await ws_manager.broadcast("scan_progress", {
                "scan_id": scan_id, "progress": pct, "found": found_count,
                "scanned": scanned_count, "total": total,
            })

    except asyncio.CancelledError:
        scan_progress_tracker.update(scan_id, status="stopped")
        return

    scan_progress_tracker.update(scan_id, status="completed", progress=100)
    await ws_manager.broadcast("scan_complete", {"scan_id": scan_id, "found": found_count, "total": total})
    if scan_id in _active_scans: del _active_scans[scan_id]


@router.get("/status/{scan_id}")
async def get_scan_status(scan_id: str):
    """Get the progress of a running scan."""
    progress = scan_progress_tracker.get(scan_id)
    if not progress:
        raise HTTPException(status_code=404, detail="Scan not found")
    return progress


@router.get("/devices")
async def get_discovered_devices(
    limit: Optional[int] = Query(None, ge=1, le=1000),
    offset: Optional[int] = Query(None, ge=0),
    session: AsyncSession = Depends(get_session),
):
    """List all discovered devices that haven't been approved yet.

    `limit` / `offset` are optional: when omitted, the full list is returned
    (legacy behavior), so existing frontend callers are unaffected.
    """
    stmt = select(DiscoveredDevice).order_by(
        DiscoveredDevice.approved, DiscoveredDevice.discovered_at.desc()
    )
    if limit is not None:
        stmt = stmt.limit(limit)
    if offset is not None:
        stmt = stmt.offset(offset)
    result = await session.execute(stmt)
    devices = result.scalars().all()
    return [
        {
            "id": d.id,
            "ip_address": d.ip_address,
            "hostname": d.hostname,
            "device_type": d.device_type,
            "vendor": d.vendor,
            "snmp_available": d.snmp_available,
            "icmp_reachable": d.icmp_reachable,
            "mac_address": d.mac_address,
            "os_type": d.os_type,
            "open_ports": d.open_ports,
            "discovery_method": d.discovery_method,
            "discovered_at": d.discovered_at.isoformat() if d.discovered_at else None,
            "approved": d.approved,
        }
        for d in devices
    ]


class ApproveRequest(BaseModel):
    name: str
    device_type: str = "other"
    snmp_version: str = "2c"
    snmp_community: str = "public"
    snmp_port: int = 161
    snmp_enabled: bool = True


@router.post("/devices/{device_id}/approve")
async def approve_device(
    device_id: str,
    req: ApproveRequest,
    session: AsyncSession = Depends(get_session),
):
    """Approve a discovered device and add it to managed devices."""
    logger.info(f"[APPROVE] Start — device_id={device_id} name={req.name} type={req.device_type} snmp_enabled={req.snmp_enabled}")

    try:
        result = await session.execute(
            select(DiscoveredDevice).where(DiscoveredDevice.id == device_id)
        )
        discovered = result.scalar_one_or_none()
        if not discovered:
            logger.warning(f"[APPROVE] DiscoveredDevice not found: {device_id}")
            raise HTTPException(status_code=404, detail=f"Discovered device {device_id} not found")
        if discovered.approved:
            raise HTTPException(status_code=400, detail="Device already approved")

        logger.info(f"[APPROVE] Found discovered device — ip={discovered.ip_address} hostname={discovered.hostname} snmp={discovered.snmp_available}")

        # Check if a managed device with this IP already exists
        existing = await session.execute(
            select(Device).where(Device.ip_address == discovered.ip_address)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400,
                detail=f"Device with IP {discovered.ip_address} already exists in managed devices")

        # Create managed device
        protocol = "snmp" if (req.snmp_enabled and discovered.snmp_available) else "icmp"
        device = Device(
            name=req.name,
            ip_address=discovered.ip_address,
            hostname=discovered.hostname,
            device_type=req.device_type or discovered.device_type or "other",
            vendor=discovered.vendor,
            snmp_enabled=req.snmp_enabled and discovered.snmp_available,
            snmp_version=req.snmp_version,
            snmp_community=req.snmp_community or discovered.snmp_community or "public",
            snmp_port=req.snmp_port,
            protocol=protocol,
            status="online" if discovered.icmp_reachable else "unknown",
        )
        session.add(device)
        await session.flush()

        logger.info(f"[APPROVE] Device created — new_id={device.id} name={device.name} status={device.status}")

        # Mark discovered device as approved
        discovered.approved = True
        discovered.approved_device_id = device.id
        await session.commit()

        logger.info(f"[APPROVE] Committed — device={device.id} is now managed")

        # Verify it's actually in the DB
        verify = await session.execute(select(Device).where(Device.id == device.id))
        db_device = verify.scalar_one_or_none()
        logger.info(f"[APPROVE] Verify — device in DB: {db_device is not None}, total devices: {(await session.execute(select(Device))).scalars().all().__len__()}")

        await ws_manager.broadcast("device_added", {
            "device_id": device.id,
            "name": device.name,
            "ip_address": device.ip_address,
        })

        return {"id": device.id, "name": device.name, "status": "approved"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[APPROVE] FAILED — {e}\n{traceback.format_exc()}")
        await session.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to approve device: {str(e)}")


@router.get("/pingtest/{ip}")
async def ping_test(ip: str):
    """Minimal ping test — does subprocess work?"""
    import subprocess
    try:
        out = subprocess.run(["sudo", "/usr/bin/ping", "-c", "1", "-W", "2", ip], capture_output=True, text=True, timeout=5)
        return {"ok": out.returncode==0, "exit": out.returncode, "stdout": out.stdout.strip()[:300], "stderr": out.stderr.strip()[:300]}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.get("/debug/{ip}")
async def debug_scan(ip: str):
    """Debug endpoint: scan a single IP and return ALL raw discovery data."""
    import asyncio as aio
    from ..services.scanner import (
        _get_arp_for_ip, _read_arp_table, nmap_scan, nmap_scan_detailed,
        NetworkScanner, mac_oui_to_vendor,
    )
    import socket, re

    result = {"ip": ip, "steps": {}}

    # Step 2: ARP
    arp = _get_arp_for_ip(ip)
    result["steps"]["arp"] = {"data": arp}
    if arp and arp.get("mac"):
        result["steps"]["arp"]["oui_vendor"] = mac_oui_to_vendor(arp["mac"])

    # Step 3: Full ARP table
    try:
        table = _read_arp_table()
        result["steps"]["arp_table"] = {"entries": len(table), "sample": dict(list(table.items())[:5])}
    except Exception as e:
        result["steps"]["arp_table"] = {"error": str(e)}

    # Step 4: DNS
    try:
        loop = aio.get_event_loop()
        hostname = await loop.run_in_executor(None, socket.gethostbyaddr, ip)
        result["steps"]["dns"] = {"hostname": hostname[0]}
    except Exception as e:
        result["steps"]["dns"] = {"error": str(e)}

    # Step 5: nmap
    try:
        loop = aio.get_event_loop()
        nmap = await loop.run_in_executor(None, nmap_scan, ip)
        result["steps"]["nmap"] = {"data": nmap}
    except Exception as e:
        result["steps"]["nmap"] = {"error": str(e)}

    # Step 6: TCP ports
    scanner = NetworkScanner()
    try:
        ports = await scanner._tcp_probe(ip, [22, 80, 443, 161, 3389, 8080])
        result["steps"]["tcp_ports"] = {"open": ports}
    except Exception as e:
        result["steps"]["tcp_ports"] = {"error": str(e)}

    # Step 7: Hostname via NetBIOS (quick)
    try:
        import subprocess as sp
        nmb = sp.run(["timeout", "3", "nmblookup", "-A", ip], capture_output=True, text=True, timeout=5)
        if nmb.returncode == 0:
            nmb_m = re.search(r'(\S+)\s+<00>\s+', nmb.stdout)
            result["steps"]["netbios"] = {"ok": True, "hostname": nmb_m.group(1) if nmb_m else None, "stdout": nmb.stdout[:200]}
        else:
            result["steps"]["netbios"] = {"ok": False, "exit": nmb.returncode, "stderr": nmb.stderr[:200]}
    except Exception as e:
        result["steps"]["netbios"] = {"ok": False, "error": str(e)[:200]}

    # Step 8: SNMP
    try:
        from ..services.scanner import SNMP_AVAILABLE as snmp_ok
        if snmp_ok:
            for c in ["public", "private", "admin", "snmp"]:
                info = await scanner._snmp_probe(ip, c)
                if info:
                    result["steps"]["snmp"] = {"community": c, "data": info}
                    break
            else:
                result["steps"]["snmp"] = {"error": "No community worked"}
        else:
            result["steps"]["snmp"] = {"error": "SNMP library not available"}
    except Exception as e:
        result["steps"]["snmp"] = {"error": str(e)}

    return result


@router.delete("/devices/{device_id}")
async def delete_discovered_device(
    device_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Remove a device from the discovered list."""
    result = await session.execute(
        select(DiscoveredDevice).where(DiscoveredDevice.id == device_id)
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Discovered device not found")

    await session.delete(device)
    await session.commit()
    return {"status": "deleted"}
