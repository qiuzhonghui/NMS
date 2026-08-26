"""Alert API routes."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from ..database import get_session
from ..models.alert import AlertRule, Alert
from ..websocket import ws_manager

router = APIRouter(prefix="/alerts", tags=["alerts"])


class AlertRuleCreate(BaseModel):
    name: str
    device_id: Optional[str] = None
    metric_type: str
    metric_name: str
    condition: str
    threshold: float
    severity: str = "warning"
    enabled: bool = True
    description: Optional[str] = None


class AlertRuleUpdate(BaseModel):
    name: Optional[str] = None
    metric_type: Optional[str] = None
    metric_name: Optional[str] = None
    condition: Optional[str] = None
    threshold: Optional[float] = None
    severity: Optional[str] = None
    enabled: Optional[bool] = None
    description: Optional[str] = None


@router.get("/rules")
async def list_alert_rules(
    device_id: Optional[str] = Query(None),
    limit: Optional[int] = Query(None, ge=1, le=1000),
    offset: Optional[int] = Query(None, ge=0),
    session: AsyncSession = Depends(get_session),
):
    """List all alert rules.

    `limit` / `offset` are optional: when omitted, the full list is returned
    (legacy behavior), so existing frontend callers are unaffected.
    """
    stmt = select(AlertRule)
    if device_id:
        stmt = stmt.where(
            (AlertRule.device_id == device_id) | (AlertRule.device_id.is_(None))
        )
    stmt = stmt.order_by(AlertRule.name)
    if limit is not None:
        stmt = stmt.limit(limit)
    if offset is not None:
        stmt = stmt.offset(offset)

    result = await session.execute(stmt)
    rules = result.scalars().all()

    return [
        {
            "id": r.id,
            "name": r.name,
            "device_id": r.device_id,
            "metric_type": r.metric_type,
            "metric_name": r.metric_name,
            "condition": r.condition,
            "threshold": r.threshold,
            "severity": r.severity,
            "enabled": r.enabled,
            "description": r.description,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rules
    ]


@router.post("/rules")
async def create_alert_rule(
    data: AlertRuleCreate,
    session: AsyncSession = Depends(get_session),
):
    """Create a new alert rule."""
    rule = AlertRule(
        name=data.name,
        device_id=data.device_id,
        metric_type=data.metric_type,
        metric_name=data.metric_name,
        condition=data.condition,
        threshold=data.threshold,
        severity=data.severity,
        enabled=data.enabled,
        description=data.description,
    )
    session.add(rule)
    await session.commit()
    await session.refresh(rule)

    return {"id": rule.id, "name": rule.name, "status": "created"}


@router.put("/rules/{rule_id}")
async def update_alert_rule(
    rule_id: str,
    data: AlertRuleUpdate,
    session: AsyncSession = Depends(get_session),
):
    """Update an alert rule."""
    result = await session.execute(
        select(AlertRule).where(AlertRule.id == rule_id)
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Alert rule not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(rule, key, value)

    await session.commit()
    return {"id": rule.id, "status": "updated"}


@router.delete("/rules/{rule_id}")
async def delete_alert_rule(
    rule_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Delete an alert rule."""
    result = await session.execute(
        select(AlertRule).where(AlertRule.id == rule_id)
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Alert rule not found")

    await session.delete(rule)
    await session.commit()
    return {"status": "deleted"}


@router.get("")
async def list_alerts(
    device_id: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    acknowledged: Optional[bool] = Query(None),
    limit: int = Query(100, le=500),
    session: AsyncSession = Depends(get_session),
):
    """List triggered alerts."""
    stmt = select(Alert).order_by(Alert.triggered_at.desc())

    if device_id:
        stmt = stmt.where(Alert.device_id == device_id)
    if severity:
        stmt = stmt.where(Alert.severity == severity)
    if acknowledged is not None:
        stmt = stmt.where(Alert.acknowledged == acknowledged)

    stmt = stmt.limit(limit)
    result = await session.execute(stmt)
    alerts = result.scalars().all()

    return [
        {
            "id": a.id,
            "alert_rule_id": a.alert_rule_id,
            "device_id": a.device_id,
            "message": a.message,
            "severity": a.severity,
            "acknowledged": a.acknowledged,
            "triggered_at": a.triggered_at.isoformat() if a.triggered_at else None,
            "resolved_at": a.resolved_at.isoformat() if a.resolved_at else None,
        }
        for a in alerts
    ]


@router.post("/{alert_id}/acknowledge")
async def acknowledge_alert(
    alert_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Acknowledge an alert."""
    result = await session.execute(
        select(Alert).where(Alert.id == alert_id)
    )
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    alert.acknowledged = True
    await session.commit()
    return {"id": alert.id, "status": "acknowledged"}
