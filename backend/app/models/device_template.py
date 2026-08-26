"""Device model definitions and monitoring templates."""
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base
from .device import gen_uuid


class DeviceModel(Base):
    """Pre-defined device model (e.g. Cisco ISR4331, Huawei CE6800)."""

    __tablename__ = "device_models"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_uuid)
    vendor: Mapped[str] = mapped_column(String(100), nullable=False)
    model_name: Mapped[str] = mapped_column(String(100), nullable=False)
    device_type: Mapped[str] = mapped_column(
        String(50), nullable=False,
        comment="router, switch, firewall, server_linux, server_windows, other"
    )
    category: Mapped[str] = mapped_column(
        String(50), nullable=False, default="network",
        comment="network, server, custom"
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    snmp_profile: Mapped[str | None] = mapped_column(
        String(100), nullable=True,
        comment="key into snmp_profiles.py (legacy)"
    )
    template_type: Mapped[str | None] = mapped_column(
        String(20), nullable=True,
        comment="snmp, mib, cisco, zabbix"
    )
    template_ref_id: Mapped[str | None] = mapped_column(
        String(32), nullable=True,
        comment="ID of the selected template/MIB/list"
    )
    icon: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    templates: Mapped[list["MonitoringTemplate"]] = relationship(
        "MonitoringTemplate", back_populates="device_model", cascade="all, delete-orphan"
    )


class MonitoringTemplate(Base):
    """Monitoring template that can be applied to devices."""

    __tablename__ = "monitoring_templates"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    device_model_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("device_models.id", ondelete="SET NULL"), nullable=True
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str | None] = mapped_column(
        String(50), nullable=True, default="manual",
        comment="Source of this template: 'manual', 'zabbix', 'mib'"
    )
    mib_file_ids: Mapped[str | None] = mapped_column(
        JSON, nullable=True,
        comment="JSON array of associated MIB file IDs"
    )
    cisco_list_ids: Mapped[str | None] = mapped_column(
        JSON, nullable=True,
        comment="JSON array of associated Cisco support list file IDs"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    device_model: Mapped[Optional["DeviceModel"]] = relationship(
        "DeviceModel", back_populates="templates"
    )
    items: Mapped[list["TemplateItem"]] = relationship(
        "TemplateItem", back_populates="template", cascade="all, delete-orphan"
    )


class TemplateItem(Base):
    """Individual monitoring item within a template."""

    __tablename__ = "template_items"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_uuid)
    template_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("monitoring_templates.id", ondelete="CASCADE"),
        nullable=False
    )
    metric_name: Mapped[str] = mapped_column(String(255), nullable=False)
    metric_type: Mapped[str] = mapped_column(
        String(50), nullable=False,
        comment="cpu, memory, disk, network, port, protocol, table, custom"
    )
    protocol: Mapped[str] = mapped_column(
        String(20), nullable=False, default="snmp",
        comment="snmp, icmp, agent, web"
    )
    oid_or_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    data_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="gauge",
        comment="gauge, counter, table, text"
    )
    unit: Mapped[str | None] = mapped_column(String(50), nullable=True)
    display_type: Mapped[str] = mapped_column(String(20), default="chart", comment="chart, gauge, text, table")
    interval_seconds: Mapped[int] = mapped_column(Integer, default=60)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    template: Mapped["MonitoringTemplate"] = relationship("MonitoringTemplate", back_populates="items")


class ParsedOid(Base):
    """持久化存储 MIB 解析结果，含中英文描述。"""
    __tablename__ = "parsed_oids"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_uuid)
    oid: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description_zh: Mapped[str | None] = mapped_column(String(500), nullable=True)
    description_en: Mapped[str | None] = mapped_column(String(500), nullable=True)
    mib_source: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class MibFile(Base):
    """已上传的 MIB 文件和 Cisco 支持列表。"""
    __tablename__ = "mib_files"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_uuid)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_type: Mapped[str] = mapped_column(String(20), nullable=False, comment="mib, cisco_list")
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    oid_count: Mapped[int] = mapped_column(Integer, default=0)
    mib_count: Mapped[int] = mapped_column(Integer, default=0)
    parsed_oids: Mapped[dict | None] = mapped_column(JSON, nullable=True, comment="Parsed OID list from this MIB")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class OidTestResult(Base):
    """OID 测试结果持久化存储。"""
    __tablename__ = "oid_test_results"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_uuid)
    oid: Mapped[str] = mapped_column(String(500), nullable=False, index=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    result_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    test_ip: Mapped[str | None] = mapped_column(String(50), nullable=True)
    tested_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AISettings(Base):
    """AI 分析配置 — API key、模型名等必要参数。"""
    __tablename__ = "ai_settings"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_uuid)
    provider: Mapped[str] = mapped_column(String(50), nullable=False, default="openai",
                                          comment="openai, azure, local, deepseek, custom")
    api_key: Mapped[str] = mapped_column(String(500), nullable=False)
    api_base: Mapped[str] = mapped_column(String(500), nullable=False,
                                          default="https://api.openai.com/v1")
    model_name: Mapped[str] = mapped_column(String(100), nullable=False, default="gpt-4o-mini")
    batch_size: Mapped[int] = mapped_column(Integer, default=100,
                                            comment="每轮AI分析的最大OID数量")
    ai_concurrency: Mapped[int] = mapped_column(Integer, default=3,
                                                comment="AI分析并发批次数")
    request_timeout: Mapped[int] = mapped_column(Integer, default=120,
                                                 comment="单次AI请求超时(秒)")
    group_timeout: Mapped[int] = mapped_column(Integer, default=180,
                                               comment="并发组超时(秒)")
    test_concurrency: Mapped[int] = mapped_column(Integer, default=3,
                                                  comment="SNMP测试并发数")
    test_retries: Mapped[int] = mapped_column(Integer, default=1,
                                              comment="SNMP测试重试次数")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow,
                                                 onupdate=datetime.utcnow)
