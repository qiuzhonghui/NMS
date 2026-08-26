"""Metric and Interface models for time-series data."""
from datetime import datetime
from typing import Optional

from sqlalchemy import String, DateTime, Integer, Float, ForeignKey, Text, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base
from .device import gen_uuid


class DeviceMetric(Base):
    """Time-series metric data for a device (CPU, memory, disk, network)."""

    __tablename__ = "device_metrics"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_uuid)
    device_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    metric_type: Mapped[str] = mapped_column(
        String(50), nullable=False, comment="cpu, memory, disk, network"
    )
    metric_name: Mapped[str] = mapped_column(
        String(100), nullable=False, comment="e.g. cpu_usage, mem_total, disk_used_pct"
    )
    value: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(20), default="%")
    collected_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    # Relationship
    device: Mapped["Device"] = relationship("Device", back_populates="metrics")

    __table_args__ = (
        Index("idx_device_metric_time", "device_id", "metric_type", "collected_at"),
    )


class DeviceInterface(Base):
    """Network interface on a device."""

    __tablename__ = "device_interfaces"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_uuid)
    device_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    if_index: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    if_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    mac_address: Mapped[Optional[str]] = mapped_column(String(17), nullable=True)
    speed: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, comment="bps")
    status: Mapped[str] = mapped_column(String(10), default="unknown",
                                         comment="up, down, unknown")
    alias: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    last_change: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Relationship
    device: Mapped["Device"] = relationship("Device", back_populates="interfaces")
    metrics: Mapped[list["InterfaceMetric"]] = relationship(
        "InterfaceMetric", back_populates="interface", cascade="all, delete-orphan"
    )


class InterfaceMetric(Base):
    """Traffic statistics for a network interface."""

    __tablename__ = "interface_metrics"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_uuid)
    interface_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("device_interfaces.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    in_octets: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    out_octets: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    in_errors: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    out_errors: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    in_discards: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    out_discards: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    collected_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    # Relationship
    interface: Mapped["DeviceInterface"] = relationship("DeviceInterface", back_populates="metrics")

    __table_args__ = (
        Index("idx_iface_metric_time", "interface_id", "collected_at"),
    )
