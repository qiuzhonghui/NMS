"""Topology node and edge models for the network map."""
from datetime import datetime
from typing import Optional

from sqlalchemy import String, DateTime, Integer, Float, ForeignKey, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .device import gen_uuid


class TopologyNode(Base):
    """A node on the topology canvas — can be a device, text label, or image."""

    __tablename__ = "topology_nodes"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_uuid)
    device_id: Mapped[Optional[str]] = mapped_column(
        String(32), ForeignKey("devices.id", ondelete="SET NULL"), nullable=True, index=True
    )
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    node_type: Mapped[str] = mapped_column(
        String(20), default="device", comment="device, manual, text, image"
    )
    x: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    y: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    width: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    height: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    image_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    text_content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    discovery_source: Mapped[str] = mapped_column(
        String(20), default="manual", comment="manual, auto, cdp, lldp"
    )
    canvas_data: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class TopologyEdge(Base):
    """A connection (edge) between two nodes on the topology canvas."""

    __tablename__ = "topology_edges"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_uuid)
    source_node_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("topology_nodes.id", ondelete="CASCADE"), nullable=False
    )
    target_node_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("topology_nodes.id", ondelete="CASCADE"), nullable=False
    )
    label: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    edge_type: Mapped[str] = mapped_column(
        String(20), default="wired", comment="wired, wireless, lag"
    )
    discovery_source: Mapped[str] = mapped_column(
        String(20), default="manual", comment="manual, auto, cdp, lldp"
    )
    source_interface: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    target_interface: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    line_style: Mapped[str] = mapped_column(
        String(20), default="solid", comment="solid, dashed, dotted"
    )
    color: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
