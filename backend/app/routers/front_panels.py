"""Front panel API routes."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_session
from ..models.front_panel import FrontPanel, FrontPanelPort
from ..models.metrics import DeviceInterface

router = APIRouter(prefix="/front-panels", tags=["front_panels"])


class FrontPanelCreate(BaseModel):
    name: str
    device_model: str | None = None
    width: int = 800
    height: int = 300
    background_image: str | None = None
    ports_layout: dict | None = None


class FrontPanelUpdate(BaseModel):
    name: str | None = None
    width: int | None = None
    height: int | None = None
    background_image: str | None = None
    ports_layout: dict | None = None


class PortCreate(BaseModel):
    label: str
    port_type: str = "rj45"
    x: float = 0
    y: float = 0
    interface_id: str | None = None
    status_oid: str | None = None


class PortUpdate(BaseModel):
    label: str | None = None
    port_type: str | None = None
    x: float | None = None
    y: float | None = None
    interface_id: str | None = None
    status_oid: str | None = None


@router.get("")
async def list_front_panels(
    session: AsyncSession = Depends(get_session),
):
    """List all front panel templates."""
    result = await session.execute(
        select(FrontPanel).order_by(FrontPanel.name)
    )
    panels = result.scalars().all()

    return [
        {
            "id": p.id,
            "name": p.name,
            "device_model": p.device_model,
            "width": p.width,
            "height": p.height,
            "background_image": p.background_image,
            "ports_layout": p.ports_layout,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        }
        for p in panels
    ]


@router.post("")
async def create_front_panel(
    data: FrontPanelCreate,
    session: AsyncSession = Depends(get_session),
):
    """Create a new front panel template."""
    panel = FrontPanel(
        name=data.name,
        device_model=data.device_model,
        width=data.width,
        height=data.height,
        background_image=data.background_image,
        ports_layout=data.ports_layout,
    )
    session.add(panel)
    await session.commit()
    await session.refresh(panel)

    return {"id": panel.id, "name": panel.name, "status": "created"}


@router.put("/{panel_id}")
async def update_front_panel(
    panel_id: str,
    data: FrontPanelUpdate,
    session: AsyncSession = Depends(get_session),
):
    """Update a front panel template."""
    result = await session.execute(
        select(FrontPanel).where(FrontPanel.id == panel_id)
    )
    panel = result.scalar_one_or_none()
    if not panel:
        raise HTTPException(status_code=404, detail="Front panel not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(panel, key, value)

    await session.commit()
    return {"id": panel.id, "status": "updated"}


@router.delete("/{panel_id}")
async def delete_front_panel(
    panel_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Delete a front panel template and its ports."""
    result = await session.execute(
        select(FrontPanel).where(FrontPanel.id == panel_id)
    )
    panel = result.scalar_one_or_none()
    if not panel:
        raise HTTPException(status_code=404, detail="Front panel not found")

    await session.delete(panel)
    await session.commit()
    return {"status": "deleted"}


@router.get("/{panel_id}/ports")
async def get_panel_ports(
    panel_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Get all ports on a front panel with their current interface status."""
    result = await session.execute(
        select(FrontPanel)
        .where(FrontPanel.id == panel_id)
        .options(selectinload(FrontPanel.ports))
    )
    panel = result.scalar_one_or_none()
    if not panel:
        raise HTTPException(status_code=404, detail="Front panel not found")

    # Load all linked interfaces in a single query (avoids N+1)
    interface_ids = [port.interface_id for port in panel.ports if port.interface_id]
    ifaces: dict[str, DeviceInterface] = {}
    if interface_ids:
        iface_result = await session.execute(
            select(DeviceInterface).where(DeviceInterface.id.in_(interface_ids))
        )
        ifaces = {i.id: i for i in iface_result.scalars().all()}

    ports_data = []
    for port in panel.ports:
        port_info = {
            "id": port.id,
            "label": port.label,
            "port_type": port.port_type,
            "x": port.x,
            "y": port.y,
            "status": "unknown",
            "interface_id": port.interface_id,
        }

        # Attach interface status if linked
        iface = ifaces.get(port.interface_id) if port.interface_id else None
        if iface:
            port_info["status"] = iface.status
            port_info["if_name"] = iface.name
            port_info["if_speed"] = iface.speed

        ports_data.append(port_info)

    return ports_data


@router.post("/{panel_id}/ports")
async def add_port(
    panel_id: str,
    data: PortCreate,
    session: AsyncSession = Depends(get_session),
):
    """Add a port to a front panel."""
    panel_result = await session.execute(
        select(FrontPanel).where(FrontPanel.id == panel_id)
    )
    if not panel_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Front panel not found")

    port = FrontPanelPort(
        front_panel_id=panel_id,
        label=data.label,
        port_type=data.port_type,
        x=data.x,
        y=data.y,
        interface_id=data.interface_id,
        status_oid=data.status_oid,
    )
    session.add(port)
    await session.commit()
    await session.refresh(port)

    return {"id": port.id, "label": port.label, "status": "created"}


@router.put("/{panel_id}/ports/{port_id}")
async def update_port(
    panel_id: str,
    port_id: str,
    data: PortUpdate,
    session: AsyncSession = Depends(get_session),
):
    """Update a port on a front panel."""
    result = await session.execute(
        select(FrontPanelPort).where(
            FrontPanelPort.id == port_id,
            FrontPanelPort.front_panel_id == panel_id,
        )
    )
    port = result.scalar_one_or_none()
    if not port:
        raise HTTPException(status_code=404, detail="Port not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(port, key, value)

    await session.commit()
    return {"id": port.id, "status": "updated"}


@router.delete("/{panel_id}/ports/{port_id}")
async def delete_port(
    panel_id: str,
    port_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Remove a port from a front panel."""
    result = await session.execute(
        select(FrontPanelPort).where(
            FrontPanelPort.id == port_id,
            FrontPanelPort.front_panel_id == panel_id,
        )
    )
    port = result.scalar_one_or_none()
    if not port:
        raise HTTPException(status_code=404, detail="Port not found")

    await session.delete(port)
    await session.commit()
    return {"status": "deleted"}
