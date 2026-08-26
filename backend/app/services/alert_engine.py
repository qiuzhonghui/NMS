"""Alert engine — evaluates alert rules and triggers alerts."""
import asyncio
from datetime import datetime
from typing import Any

from loguru import logger
from sqlalchemy import select

from ..config import settings
from ..database import async_session_factory
from ..models.alert import AlertRule, Alert
from ..models.metrics import DeviceMetric
from ..websocket import ws_manager

_running = False


async def start_alert_engine() -> None:
    """Start the alert evaluation background service."""
    global _running
    _running = True
    asyncio.create_task(_alert_loop())
    logger.info("Alert engine started")


async def stop_alert_engine() -> None:
    """Stop the alert engine."""
    global _running
    _running = False
    logger.info("Alert engine stopped")


async def _alert_loop() -> None:
    """Main loop: evaluates alert rules periodically."""
    while _running:
        try:
            await _evaluate_rules()
        except Exception as e:
            logger.error(f"Alert engine error: {e}")

        await asyncio.sleep(settings.ALERT_CHECK_INTERVAL)


async def _evaluate_rules() -> None:
    """Evaluate all enabled alert rules."""
    async with async_session_factory() as session:
        result = await session.execute(
            select(AlertRule).where(AlertRule.enabled == True)
        )
        rules = result.scalars().all()

        for rule in rules:
            try:
                # Get latest metric value
                metric_stmt = select(DeviceMetric).where(
                    DeviceMetric.metric_name == rule.metric_name,
                    DeviceMetric.metric_type == rule.metric_type,
                )

                if rule.device_id:
                    metric_stmt = metric_stmt.where(
                        DeviceMetric.device_id == rule.device_id
                    )

                metric_stmt = metric_stmt.order_by(
                    DeviceMetric.collected_at.desc()
                ).limit(1)

                metric_result = await session.execute(metric_stmt)
                latest_metric = metric_result.scalar_one_or_none()

                if not latest_metric:
                    continue

                # Check if threshold is crossed
                if _evaluate_condition(
                    latest_metric.value, rule.condition, rule.threshold
                ):
                    # Check if an unresolved alert already exists for this rule+device
                    existing = await session.execute(
                        select(Alert).where(
                            Alert.alert_rule_id == rule.id,
                            Alert.device_id == latest_metric.device_id,
                            Alert.resolved_at.is_(None),
                        )
                    )
                    if existing.scalar_one_or_none():
                        continue  # Already alerted

                    alert = Alert(
                        alert_rule_id=rule.id,
                        device_id=latest_metric.device_id,
                        message=(
                            f"{rule.name}: {rule.metric_name} is "
                            f"{latest_metric.value}{latest_metric.unit} "
                            f"({rule.condition} {rule.threshold})"
                        ),
                        severity=rule.severity,
                        triggered_at=datetime.utcnow(),
                    )
                    session.add(alert)
                    await session.commit()
                    await session.refresh(alert)

                    # Notify via WebSocket
                    await ws_manager.broadcast("alert", {
                        "alert_id": alert.id,
                        "device_id": alert.device_id,
                        "severity": alert.severity,
                        "message": alert.message,
                    })

                    logger.info(f"Alert triggered: {alert.message}")

                else:
                    # Resolve any open alerts for this rule that are no longer triggered
                    open_alerts = await session.execute(
                        select(Alert).where(
                            Alert.alert_rule_id == rule.id,
                            Alert.resolved_at.is_(None),
                        )
                    )
                    for open_alert in open_alerts.scalars().all():
                        open_alert.resolved_at = datetime.utcnow()
                    await session.commit()

            except Exception as e:
                logger.error(f"Error evaluating rule {rule.name}: {e}")


def _evaluate_condition(value: float, condition: str, threshold: float) -> bool:
    """Check if a value satisfies a condition against a threshold."""
    if condition == ">":
        return value > threshold
    elif condition == "<":
        return value < threshold
    elif condition == ">=":
        return value >= threshold
    elif condition == "<=":
        return value <= threshold
    elif condition == "==":
        return value == threshold
    return False
