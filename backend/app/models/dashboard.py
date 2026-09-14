"""Custom dashboards and widgets."""
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base
from ..utils.ids import gen_uuid


class Dashboard(Base):
    """User-customizable dashboard."""

    __tablename__ = "dashboards"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    widgets: Mapped[list["DashboardWidget"]] = relationship(
        "DashboardWidget", back_populates="dashboard", cascade="all, delete-orphan"
    )


class DashboardWidget(Base):
    """Widget within a dashboard."""

    __tablename__ = "dashboard_widgets"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_uuid)
    dashboard_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("dashboards.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    widget_type: Mapped[str] = mapped_column(
        String(20), nullable=False,
        comment="chart, gauge, table, text, stat, topn, number"
    )
    config: Mapped[dict | None] = mapped_column(
        JSON, nullable=True,
        comment="Stores: metric_keys, device_ids, chart_type, refresh_interval, "
                "time_range, group_by, top_n, thresholds, ..."
    )
    position_x: Mapped[int] = mapped_column(Integer, default=0)
    position_y: Mapped[int] = mapped_column(Integer, default=0)
    width: Mapped[int] = mapped_column(Integer, default=4)
    height: Mapped[int] = mapped_column(Integer, default=3)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    dashboard: Mapped["Dashboard"] = relationship(
        "Dashboard", back_populates="widgets"
    )
