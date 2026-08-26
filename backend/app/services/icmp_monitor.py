"""ICMP reachability monitor — periodically checks all managed devices."""
import asyncio
from datetime import datetime

from loguru import logger
from sqlalchemy import select

try:
    from ping3 import ping
except ImportError:
    ping = None

from ..database import async_session_factory
from ..models.device import Device
from ..models.metrics import DeviceMetric
from ..websocket import ws_manager

_running = False
_check_interval = 15  # seconds, configurable
_CHECK_CONCURRENCY = 100  # max concurrent reachability probes per round


async def start_monitor() -> None:
    global _running
    _running = True
    asyncio.create_task(_monitor_loop())
    logger.info(f"ICMP monitor started (interval={_check_interval}s)")


async def stop_monitor() -> None:
    global _running
    _running = False
    logger.info("ICMP monitor stopped")


def set_interval(seconds: int) -> None:
    global _check_interval
    _check_interval = max(5, min(seconds, 3600))


async def _monitor_loop() -> None:
    while _running:
        try:
            async with async_session_factory() as session:
                result = await session.execute(select(Device))
                devices = result.scalars().all()
                now = datetime.utcnow()

                # Probe all devices concurrently (network I/O only); DB writes
                # stay sequential below so the session is used by one coroutine.
                sem = asyncio.Semaphore(_CHECK_CONCURRENCY)

                async def _probe(device) -> tuple:
                    async with sem:
                        return device, await _check_reachability(device.ip_address)

                probes = await asyncio.gather(*(_probe(d) for d in devices))

                for device, latency_ms in probes:
                    is_alive = latency_ms is not None

                    # Don't change unknown→offline; only unknown→online on first confirmed ping
                    if device.status == "unknown":
                        new_status = "online" if is_alive else "unknown"
                    else:
                        new_status = "online" if is_alive else "offline"

                    if device.status != new_status:
                        device.status = new_status
                        device.last_seen = now
                        await session.commit()
                        await ws_manager.broadcast_to_subscribers(
                            device.id, "device_status",
                            {"status": new_status}
                        )
                        logger.info(f"ICMP: {device.name} ({device.ip_address}) → {new_status}")
                    elif is_alive:
                        # Update last_seen on every successful ping
                        device.last_seen = now
                        await session.commit()

                    # Save metric
                    if is_alive and latency_ms is not None:
                        session.add(DeviceMetric(
                            device_id=device.id, metric_type="icmp",
                            metric_name="icmp_latency_ms",
                            value=round(latency_ms, 1), unit="ms",
                            collected_at=now,
                        ))
                    session.add(DeviceMetric(
                        device_id=device.id, metric_type="icmp",
                        metric_name="icmp_reachable",
                        value=1.0 if is_alive else 0.0, unit="",
                        collected_at=now,
                    ))

                await session.commit()

        except Exception as e:
            logger.error(f"ICMP monitor error: {e}")

        await asyncio.sleep(_check_interval)


async def _check_reachability(ip: str) -> float | None:
    """Check if device is reachable. Returns latency in ms or None."""
    # 1. Try ICMP ping
    if ping is not None:
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, lambda: ping(ip, timeout=2.0))
            if result is not None and result is not False:
                return float(result) * 1000  # ping3 returns seconds, convert to ms
        except Exception:
            pass

    # 2. Fallback: TCP ping to common ports
    for port in [22, 80, 443, 161, 3389, 8080, 8000, 9090]:
        try:
            start = asyncio.get_event_loop().time()
            _, writer = await asyncio.wait_for(
                asyncio.open_connection(ip, port), timeout=1.5
            )
            elapsed = (asyncio.get_event_loop().time() - start) * 1000
            writer.close()
            await writer.wait_closed()
            return elapsed
        except Exception:
            continue

    return None
