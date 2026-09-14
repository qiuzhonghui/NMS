"""Web scraping configs and port/protocol data."""
from datetime import datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from ..utils.ids import gen_uuid


class WebScraperConfig(Base):
    """Configuration for scraping data from device web interfaces."""

    __tablename__ = "web_scraper_configs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_uuid)
    device_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    selector_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="css",
        comment="css, xpath, regex"
    )
    data_selector: Mapped[str] = mapped_column(String(1000), nullable=False)
    metric_name: Mapped[str] = mapped_column(String(255), nullable=False)
    refresh_interval: Mapped[int] = mapped_column(Integer, default=300)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DevicePort(Base):
    """Detailed port information collected from devices."""

    __tablename__ = "device_ports"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_uuid)
    device_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    )
    port_name: Mapped[str] = mapped_column(String(100), nullable=False)
    port_index: Mapped[int] = mapped_column(Integer, nullable=False)
    mac_address: Mapped[str | None] = mapped_column(String(20), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    vlan: Mapped[int | None] = mapped_column(Integer, nullable=True)
    speed: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    duplex: Mapped[str | None] = mapped_column(String(20), nullable=True)
    status: Mapped[str] = mapped_column(String(10), default="down", comment="up, down")
    admin_status: Mapped[str | None] = mapped_column(String(10), nullable=True)
    in_octets: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    out_octets: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    in_errors: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    out_errors: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    collected_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_device_ports_device_port_collected",
              "device_id", "port_name", "collected_at"),
    )


class DeviceProtocolData(Base):
    """Stores protocol table data: route table, ARP, DHCP, NDP, CDP, LLDP, etc."""

    __tablename__ = "device_protocol_data"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_uuid)
    device_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    )
    data_type: Mapped[str] = mapped_column(
        String(50), nullable=False,
        comment="route, arp, dhcp, ndp, cdp, lldp, firewall_rules, nat_rules"
    )
    data: Mapped[dict] = mapped_column(JSON, nullable=False)
    collected_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_device_protocol_data_device_type_collected",
              "device_id", "data_type", "collected_at"),
    )
