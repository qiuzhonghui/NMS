"""Dashboard and widget API routes."""
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func
from sqlalchemy.orm import selectinload
from pydantic import BaseModel

from ..database import get_session
from ..models.dashboard import Dashboard, DashboardWidget
from ..models.metrics import DeviceMetric

router = APIRouter(prefix="/dashboards", tags=["dashboards"])


# ═══════════════════════════════════════════════════════════════════════════
# Pydantic schemas
# ═══════════════════════════════════════════════════════════════════════════

class DashboardCreate(BaseModel):
    name: str
    description: Optional[str] = None


class DashboardUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class WidgetCreate(BaseModel):
    title: str
    widget_type: str                      # chart, gauge, table, text, stat, topn, number
    config: Optional[dict] = None         # {metric_keys, device_ids, chart_type, ...}
    x: int = 0
    y: int = 0
    w: int = 4
    h: int = 3


class WidgetUpdate(BaseModel):
    title: Optional[str] = None
    widget_type: Optional[str] = None
    config: Optional[dict] = None
    x: Optional[int] = None
    y: Optional[int] = None
    w: Optional[int] = None
    h: Optional[int] = None


# ═══════════════════════════════════════════════════════════════════════════
# Dashboard CRUD
# ═══════════════════════════════════════════════════════════════════════════

@router.get("")
async def list_dashboards(
    session: AsyncSession = Depends(get_session),
):
    """List all dashboards."""
    result = await session.execute(
        select(Dashboard)
        .options(selectinload(Dashboard.widgets))
        .order_by(Dashboard.created_at.desc())
    )
    dashboards = result.scalars().all()

    return [
        {
            "id": d.id,
            "name": d.name,
            "description": d.description,
            "is_default": d.is_default,
            "widget_count": len(d.widgets) if d.widgets else 0,
            "created_at": d.created_at.isoformat() if d.created_at else None,
        }
        for d in dashboards
    ]


@router.post("")
async def create_dashboard(
    data: DashboardCreate,
    session: AsyncSession = Depends(get_session),
):
    """Create a new dashboard."""
    dashboard = Dashboard(
        name=data.name,
        description=data.description,
    )
    session.add(dashboard)
    await session.commit()
    await session.refresh(dashboard)

    return {"id": dashboard.id, "name": dashboard.name, "status": "created"}


@router.put("/{dashboard_id}")
async def update_dashboard(
    dashboard_id: str,
    data: DashboardUpdate,
    session: AsyncSession = Depends(get_session),
):
    """Update a dashboard."""
    result = await session.execute(
        select(Dashboard).where(Dashboard.id == dashboard_id)
    )
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(dashboard, key, value)

    await session.commit()
    return {"id": dashboard.id, "status": "updated"}


@router.delete("/{dashboard_id}")
async def delete_dashboard(
    dashboard_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Delete a dashboard and all its widgets."""
    result = await session.execute(
        select(Dashboard).where(Dashboard.id == dashboard_id)
    )
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    await session.delete(dashboard)
    await session.commit()
    return {"status": "deleted"}


# ═══════════════════════════════════════════════════════════════════════════
# Dashboard Widgets CRUD
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/{dashboard_id}")
async def get_dashboard(
    dashboard_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Get a single dashboard with all its widgets."""
    result = await session.execute(
        select(Dashboard).where(Dashboard.id == dashboard_id)
    )
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    widgets = [
        {
            "id": w.id,
            "title": w.title,
            "widget_type": w.widget_type,
            "config": w.config,
            "x": w.position_x,
            "y": w.position_y,
            "w": w.width,
            "h": w.height,
        }
        for w in (dashboard.widgets or [])
    ]

    return {
        "id": dashboard.id,
        "name": dashboard.name,
        "description": dashboard.description,
        "is_default": dashboard.is_default,
        "widgets": widgets,
        "created_at": dashboard.created_at.isoformat() if dashboard.created_at else None,
    }


@router.get("/{dashboard_id}/widgets")
async def list_widgets(
    dashboard_id: str,
    session: AsyncSession = Depends(get_session),
):
    """List all widgets on a dashboard."""
    result = await session.execute(
        select(DashboardWidget)
        .where(DashboardWidget.dashboard_id == dashboard_id)
        .order_by(DashboardWidget.position_y, DashboardWidget.position_x)
    )
    widgets = result.scalars().all()

    return [
        {
            "id": w.id,
            "title": w.title,
            "widget_type": w.widget_type,
            "config": w.config,
            "x": w.position_x,
            "y": w.position_y,
            "w": w.width,
            "h": w.height,
        }
        for w in widgets
    ]


@router.post("/{dashboard_id}/widgets")
async def create_widget(
    dashboard_id: str,
    data: WidgetCreate,
    session: AsyncSession = Depends(get_session),
):
    """Create a new widget on a dashboard."""
    # Verify dashboard exists
    result = await session.execute(
        select(Dashboard)
        .where(Dashboard.id == dashboard_id)
        .options(selectinload(Dashboard.widgets))
    )
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    widget = DashboardWidget(
        dashboard_id=dashboard_id,
        title=data.title,
        widget_type=data.widget_type,
        config=data.config,
        position_x=data.x,
        position_y=data.y,
        width=data.w,
        height=data.h,
    )
    session.add(widget)
    await session.commit()
    await session.refresh(widget)

    return {
        "id": widget.id,
        "title": widget.title,
        "widget_type": widget.widget_type,
        "x": widget.position_x,
        "y": widget.position_y,
        "w": widget.width,
        "h": widget.height,
        "status": "created",
    }


@router.put("/{dashboard_id}/widgets/{widget_id}")
async def update_widget(
    dashboard_id: str,
    widget_id: str,
    data: WidgetUpdate,
    session: AsyncSession = Depends(get_session),
):
    """Update a widget."""
    result = await session.execute(
        select(DashboardWidget).where(
            DashboardWidget.id == widget_id,
            DashboardWidget.dashboard_id == dashboard_id,
        )
    )
    widget = result.scalar_one_or_none()
    if not widget:
        raise HTTPException(status_code=404, detail="Widget not found")

    update_data = data.model_dump(exclude_unset=True)
    # Map frontend-style keys (x, y, w, h) to model fields
    key_map = {"x": "position_x", "y": "position_y", "w": "width", "h": "height"}
    for key, value in update_data.items():
        model_attr = key_map.get(key, key)
        setattr(widget, model_attr, value)

    await session.commit()
    return {"id": widget.id, "status": "updated"}


@router.delete("/{dashboard_id}/widgets/{widget_id}")
async def delete_widget(
    dashboard_id: str,
    widget_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Delete a widget."""
    result = await session.execute(
        select(DashboardWidget).where(
            DashboardWidget.id == widget_id,
            DashboardWidget.dashboard_id == dashboard_id,
        )
    )
    widget = result.scalar_one_or_none()
    if not widget:
        raise HTTPException(status_code=404, detail="Widget not found")

    await session.delete(widget)
    await session.commit()
    return {"status": "deleted"}


# ═══════════════════════════════════════════════════════════════════════════
# Dashboard Data Aggregation
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/{dashboard_id}/data")
async def get_dashboard_data(
    dashboard_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Aggregate live data for all widgets on a dashboard.

    For each widget, reads widget.config.device_ids and widget.config.metric_keys,
    then queries device_metrics for the latest values.

    For widget_type="topn", returns the top 10 devices ranked by the specified metric.
    """
    # Verify dashboard exists
    result = await session.execute(
        select(Dashboard)
        .where(Dashboard.id == dashboard_id)
        .options(selectinload(Dashboard.widgets))
    )
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    widgets = dashboard.widgets or []
    widget_data: list[dict] = []

    for widget in widgets:
        config = widget.config or {}
        device_ids = config.get("device_ids", [])
        metric_keys = config.get("metric_keys", [])

        if not isinstance(device_ids, list):
            device_ids = []
        if not isinstance(metric_keys, list):
            metric_keys = []

        widget_entry = {
            "widget_id": widget.id,
            "widget_type": widget.widget_type,
            "title": widget.title,
            "data": None,
        }

        if widget.widget_type == "topn":
            # Top N devices by the first specified metric key
            metric_name = metric_keys[0] if metric_keys else "cpu_usage"
            top_n = min(config.get("top_n", 10), 50)

            # Subquery: latest collected_at per device for this metric
            latest_subq = (
                select(
                    DeviceMetric.device_id.label("did"),
                    func.max(DeviceMetric.collected_at).label("max_ts"),
                )
                .where(DeviceMetric.metric_name == metric_name)
                .group_by(DeviceMetric.device_id)
                .subquery()
            )
            stmt = (
                select(DeviceMetric)
                .join(
                    latest_subq,
                    (DeviceMetric.device_id == latest_subq.c.did)
                    & (DeviceMetric.collected_at == latest_subq.c.max_ts),
                )
                .where(DeviceMetric.metric_name == metric_name)
            )
            metric_result = await session.execute(stmt)
            all_metrics = metric_result.scalars().all()

            # Deduplicate: keep latest per device
            latest_by_device: dict[str, dict] = {}
            for m in all_metrics:
                if m.device_id not in latest_by_device:
                    latest_by_device[m.device_id] = {
                        "device_id": m.device_id,
                        "metric_name": m.metric_name,
                        "value": m.value,
                        "unit": m.unit,
                        "collected_at": m.collected_at.isoformat() if m.collected_at else None,
                    }

            # Sort by value descending (higher is "top") and take top_n
            sorted_devices = sorted(
                latest_by_device.values(),
                key=lambda d: d["value"],
                reverse=True,
            )[:top_n]

            widget_entry["data"] = {
                "metric_name": metric_name,
                "top_n": top_n,
                "devices": sorted_devices,
            }

        else:
            # General widget: fetch latest metrics for specified devices
            if not device_ids or not metric_keys:
                widget_entry["data"] = {"metrics": [], "devices": []}
                widget_data.append(widget_entry)
                continue

            # Subquery: latest collected_at per (device_id, metric_name)
            latest_subq = (
                select(
                    DeviceMetric.device_id.label("did"),
                    DeviceMetric.metric_name.label("mname"),
                    func.max(DeviceMetric.collected_at).label("max_ts"),
                )
                .where(
                    DeviceMetric.device_id.in_(device_ids),
                    DeviceMetric.metric_name.in_(metric_keys),
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
            metric_result = await session.execute(stmt)
            all_metrics = metric_result.scalars().all()

            # Deduplicate: latest per (device_id, metric_name)
            latest: dict[str, dict] = {}
            for m in all_metrics:
                key = f"{m.device_id}:{m.metric_name}"
                if key not in latest:
                    latest[key] = {
                        "device_id": m.device_id,
                        "metric_type": m.metric_type,
                        "metric_name": m.metric_name,
                        "value": m.value,
                        "unit": m.unit,
                        "collected_at": m.collected_at.isoformat() if m.collected_at else None,
                    }

            # Group by device
            by_device: dict[str, dict] = {}
            for entry in latest.values():
                did = entry["device_id"]
                if did not in by_device:
                    by_device[did] = {"device_id": did, "metrics": []}
                by_device[did]["metrics"].append({
                    "metric_name": entry["metric_name"],
                    "metric_type": entry["metric_type"],
                    "value": entry["value"],
                    "unit": entry["unit"],
                    "collected_at": entry["collected_at"],
                })

            widget_entry["data"] = {
                "metrics": list(latest.values()),
                "devices": list(by_device.values()),
            }

        widget_data.append(widget_entry)

    return {
        "dashboard_id": dashboard_id,
        "widgets": widget_data,
    }
