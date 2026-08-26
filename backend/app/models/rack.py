"""Rack and RackDevice models for rack view."""
from datetime import datetime
from typing import List, Optional

from sqlalchemy import String, DateTime, Integer, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base
from .device import gen_uuid


class Rack(Base):
    """A server/network rack."""

    __tablename__ = "racks"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_uuid)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    location: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    height: Mapped[int] = mapped_column(Integer, nullable=False, default=42,
                                         comment="Rack height in RU (rack units)")
    width: Mapped[int] = mapped_column(Integer, nullable=False, default=19,
                                        comment="Rack width in inches")
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    rack_devices: Mapped[List["RackDevice"]] = relationship(
        "RackDevice", back_populates="rack", cascade="all, delete-orphan"
    )


class RackDevice(Base):
    """A device placed in a rack at a specific RU position."""

    __tablename__ = "rack_devices"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_uuid)
    rack_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("racks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    device_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ru_position: Mapped[int] = mapped_column(Integer, nullable=False, comment="Starting RU position (1-based from top)")
    ru_height: Mapped[int] = mapped_column(Integer, nullable=False, default=1,
                                            comment="Device height in RU")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    rack: Mapped["Rack"] = relationship("Rack", back_populates="rack_devices")
    device: Mapped["Device"] = relationship("Device")
