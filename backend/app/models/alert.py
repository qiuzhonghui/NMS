"""Alert rule and alert models."""
from datetime import datetime
from typing import Optional

from sqlalchemy import String, DateTime, Integer, Float, ForeignKey, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .device import gen_uuid


class AlertRule(Base):
    """Alert rule definition — triggers when a metric crosses a threshold."""

    __tablename__ = "alert_rules"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    device_id: Mapped[Optional[str]] = mapped_column(
        String(32), ForeignKey("devices.id", ondelete="CASCADE"), nullable=True,
        comment="NULL means global rule for all devices"
    )
    metric_type: Mapped[str] = mapped_column(
        String(50), nullable=False, comment="cpu, memory, disk, network"
    )
    metric_name: Mapped[str] = mapped_column(
        String(100), nullable=False
    )
    condition: Mapped[str] = mapped_column(
        String(5), nullable=False, comment=">, <, >=, <=, =="
    )
    threshold: Mapped[float] = mapped_column(Float, nullable=False)
    severity: Mapped[str] = mapped_column(
        String(20), default="warning", comment="info, warning, critical"
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Alert(Base):
    """A triggered alert instance."""

    __tablename__ = "alerts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_uuid)
    alert_rule_id: Mapped[Optional[str]] = mapped_column(
        String(32), ForeignKey("alert_rules.id", ondelete="SET NULL"), nullable=True
    )
    device_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    message: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(
        String(20), default="warning", comment="info, warning, critical"
    )
    acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)
    triggered_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
