"""Front panel and port models for custom device faceplate visualization."""
from datetime import datetime
from typing import Optional, List

from sqlalchemy import String, DateTime, Integer, Float, ForeignKey, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base
from .device import gen_uuid


class FrontPanel(Base):
    """Custom device front panel layout definition."""

    __tablename__ = "front_panels"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_uuid)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    device_model: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    width: Mapped[int] = mapped_column(Integer, nullable=False, default=800)
    height: Mapped[int] = mapped_column(Integer, nullable=False, default=300)
    background_image: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    ports_layout: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True,
        comment="Overall layout config: orientation, port spacing, etc.")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    ports: Mapped[List["FrontPanelPort"]] = relationship(
        "FrontPanelPort", back_populates="front_panel", cascade="all, delete-orphan"
    )


class FrontPanelPort(Base):
    """A port positioned on a front panel layout."""

    __tablename__ = "front_panel_ports"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_uuid)
    front_panel_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("front_panels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str] = mapped_column(String(50), nullable=False)
    port_type: Mapped[str] = mapped_column(
        String(20), default="rj45", comment="rj45, sfp, sfp+, qsfp, qsfp28, console, usb, power"
    )
    x: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    y: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    interface_id: Mapped[Optional[str]] = mapped_column(
        String(32), ForeignKey("device_interfaces.id", ondelete="SET NULL"), nullable=True
    )
    status_oid: Mapped[Optional[str]] = mapped_column(String(255), nullable=True,
        comment="Custom SNMP OID for port status if not linked to an interface")

    # Relationship
    front_panel: Mapped["FrontPanel"] = relationship("FrontPanel", back_populates="ports")
    interface: Mapped[Optional["DeviceInterface"]] = relationship("DeviceInterface")
