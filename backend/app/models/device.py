"""Device and DiscoveredDevice models."""
from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base

# gen_uuid 已迁至 app/utils/ids.py(中立模块,避免所有模型都依赖本文件)。
# 这里 re-export 以保持既有引用 `from .device import gen_uuid` 仍然可用。
from ..utils.ids import gen_uuid  # noqa: F401


class Device(Base):
    """Managed network device or host."""

    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    ip_address: Mapped[str] = mapped_column(String(45), nullable=False, index=True)
    device_type: Mapped[str] = mapped_column(
        String(50), nullable=False, default="other",
        comment="router, switch, firewall, server_linux, server_windows, other"
    )
    vendor: Mapped[str | None] = mapped_column(String(100), nullable=True)
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    hostname: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # SNMP settings
    snmp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    snmp_version: Mapped[str] = mapped_column(String(10), default="2c")
    snmp_community: Mapped[str | None] = mapped_column(String(100), nullable=True)
    snmp_port: Mapped[int] = mapped_column(Integer, default=161)

    # Monitoring / management protocol
    protocol: Mapped[str] = mapped_column(
        String(20), default="snmp",
        comment="snmp, icmp, agent, web"
    )
    model_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("device_models.id", ondelete="SET NULL"), nullable=True
    )
    template_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("monitoring_templates.id", ondelete="SET NULL"), nullable=True,
        comment="Monitoring template"
    )
    snmp_template_id: Mapped[str | None] = mapped_column(
        String(32), nullable=True, comment="SNMP template from templates page"
    )
    mib_file_id: Mapped[str | None] = mapped_column(
        String(32), nullable=True, comment="Associated MIB file"
    )
    cisco_list_id: Mapped[str | None] = mapped_column(
        String(32), nullable=True, comment="Associated Cisco support list"
    )
    zabbix_template_id: Mapped[str | None] = mapped_column(
        String(32), nullable=True, comment="Associated Zabbix template"
    )
    agent_port: Mapped[int | None] = mapped_column(Integer, nullable=True, default=9090)
    monitoring_interval: Mapped[int] = mapped_column(Integer, default=60)
    os_version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    serial_number: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Remote access ports
    ssh_port: Mapped[int | None] = mapped_column(Integer, nullable=True, default=22)
    rdp_port: Mapped[int | None] = mapped_column(Integer, nullable=True, default=3389)
    web_port: Mapped[int | None] = mapped_column(Integer, nullable=True, default=80)

    # Status
    status: Mapped[str] = mapped_column(String(20), default="unknown",
                                         comment="online, offline, warning, unknown")
    last_seen: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Front panel association
    front_panel_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("front_panels.id", ondelete="SET NULL"), nullable=True
    )

    # Tags as JSON array
    tags: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # Relationships
    interfaces: Mapped[list["DeviceInterface"]] = relationship(
        "DeviceInterface", back_populates="device", cascade="all, delete-orphan"
    )
    metrics: Mapped[list["DeviceMetric"]] = relationship(
        "DeviceMetric", back_populates="device", cascade="all, delete-orphan"
    )
    front_panel: Mapped[Optional["FrontPanel"]] = relationship("FrontPanel", foreign_keys=[front_panel_id])


class DiscoveredDevice(Base):
    """Devices found during network discovery, pending approval."""

    __tablename__ = "discovered_devices"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_uuid)
    ip_address: Mapped[str] = mapped_column(String(45), nullable=False, index=True)
    hostname: Mapped[str | None] = mapped_column(String(255), nullable=True)
    device_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    vendor: Mapped[str | None] = mapped_column(String(100), nullable=True)
    snmp_available: Mapped[bool] = mapped_column(Boolean, default=False)
    snmp_community: Mapped[str | None] = mapped_column(String(100), nullable=True)
    icmp_reachable: Mapped[bool] = mapped_column(Boolean, default=False)
    discovery_method: Mapped[str] = mapped_column(String(20), default="icmp")
    discovered_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    mac_address: Mapped[str | None] = mapped_column(String(17), nullable=True)
    os_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    open_ports: Mapped[str | None] = mapped_column(String(100), nullable=True)
    approved: Mapped[bool] = mapped_column(Boolean, default=False)
    approved_device_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("devices.id", ondelete="SET NULL"), nullable=True
    )
