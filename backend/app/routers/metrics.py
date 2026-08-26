"""Metrics API routes."""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from ..database import get_session
from ..models.metrics import DeviceMetric, InterfaceMetric

router = APIRouter(prefix="/metrics", tags=["metrics"])


@router.get("/latest")
async def get_latest_metrics(
    device_ids: Optional[str] = Query(None, description="Comma-separated device IDs"),
    session: AsyncSession = Depends(get_session),
):
    """Get the latest metric values for specified devices.

    The latest value per (device_id, metric_name) is resolved in SQL so no
    arbitrary row cap can silently drop device/metric pairs.
    """
    latest_subq = (
        select(
            DeviceMetric.device_id.label("did"),
            DeviceMetric.metric_name.label("mname"),
            func.max(DeviceMetric.collected_at).label("max_ts"),
        )
        .group_by(DeviceMetric.device_id, DeviceMetric.metric_name)
        .subquery()
    )
    stmt = (
        select(DeviceMetric)
        .join(
            latest_subq,
            (DeviceMetric.device_id == latest_subq.c.did)
            & (DeviceMetric.metric_name == latest_subq.c.mname)
            & (DeviceMetric.collected_at == latest_subq.c.max_ts),
        )
    )
    if device_ids:
        ids = [d.strip() for d in device_ids.split(",") if d.strip()]
        stmt = stmt.where(DeviceMetric.device_id.in_(ids))

    result = await session.execute(stmt)
    metrics = result.scalars().all()

    # Group latest by device and metric name (dedupe rows sharing a timestamp)
    grouped: dict[str, dict] = {}
    for m in metrics:
        key = f"{m.device_id}:{m.metric_name}"
        if key not in grouped:
            grouped[key] = {
                "device_id": m.device_id,
                "metric_type": m.metric_type,
                "metric_name": m.metric_name,
                "value": m.value,
                "unit": m.unit,
                "collected_at": m.collected_at.isoformat() if m.collected_at else None,
            }

    return list(grouped.values())


@router.get("/interfaces/{interface_id}")
async def get_interface_metrics(
    interface_id: str,
    from_time: Optional[str] = Query(None),
    to_time: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    session: AsyncSession = Depends(get_session),
):
    """Get historical traffic data for a specific interface."""
    stmt = select(InterfaceMetric).where(
        InterfaceMetric.interface_id == interface_id
    )
    if from_time:
        stmt = stmt.where(InterfaceMetric.collected_at >= from_time)
    if to_time:
        stmt = stmt.where(InterfaceMetric.collected_at <= to_time)

    stmt = stmt.order_by(InterfaceMetric.collected_at.desc()).limit(limit)
    result = await session.execute(stmt)
    metrics = result.scalars().all()

    return [
        {
            "id": m.id,
            "interface_id": m.interface_id,
            "in_octets": m.in_octets,
            "out_octets": m.out_octets,
            "in_errors": m.in_errors,
            "out_errors": m.out_errors,
            "in_discards": m.in_discards,
            "out_discards": m.out_discards,
            "collected_at": m.collected_at.isoformat() if m.collected_at else None,
        }
        for m in metrics
    ]
