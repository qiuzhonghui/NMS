"""Rack management API routes."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel

from ..database import get_session
from ..models.rack import Rack, RackDevice
from ..models.device import Device

router = APIRouter(prefix="/racks", tags=["racks"])


class RackCreate(BaseModel):
    name: str
    location: Optional[str] = None
    height: int = 42
    width: int = 19
    description: Optional[str] = None


class RackUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    height: Optional[int] = None
    width: Optional[int] = None
    description: Optional[str] = None


class RackDevicePlace(BaseModel):
    device_id: str
    ru_position: int
    ru_height: int = 1


class RackDeviceMove(BaseModel):
    ru_position: int


@router.get("")
async def list_racks(
    session: AsyncSession = Depends(get_session),
):
    """List all racks."""
    result = await session.execute(
        select(Rack).options(selectinload(Rack.rack_devices)).order_by(Rack.name)
    )
    racks = result.unique().scalars().all()

    return [
        {
            "id": r.id,
            "name": r.name,
            "location": r.location,
            "height": r.height,
            "width": r.width,
            "description": r.description,
            "device_count": len(r.rack_devices),
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in racks
    ]


@router.post("")
async def create_rack(
    data: RackCreate,
    session: AsyncSession = Depends(get_session),
):
    """Create a new rack."""
    rack = Rack(
        name=data.name,
        location=data.location,
        height=data.height,
        width=data.width,
        description=data.description,
    )
    session.add(rack)
    await session.commit()
    await session.refresh(rack)

    return {"id": rack.id, "name": rack.name, "status": "created"}


@router.put("/{rack_id}")
async def update_rack(
    rack_id: str,
    data: RackUpdate,
    session: AsyncSession = Depends(get_session),
):
    """Update a rack's information."""
    result = await session.execute(select(Rack).where(Rack.id == rack_id))
    rack = result.scalar_one_or_none()
    if not rack:
        raise HTTPException(status_code=404, detail="Rack not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(rack, key, value)

    await session.commit()
    return {"id": rack.id, "status": "updated"}


@router.delete("/{rack_id}")
async def delete_rack(
    rack_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Delete a rack and remove all device placements."""
    result = await session.execute(select(Rack).where(Rack.id == rack_id))
    rack = result.scalar_one_or_none()
    if not rack:
        raise HTTPException(status_code=404, detail="Rack not found")

    await session.delete(rack)
    await session.commit()
    return {"status": "deleted"}


@router.get("/{rack_id}/devices")
async def get_rack_devices(
    rack_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Get all devices placed in a rack."""
    result = await session.execute(
        select(RackDevice)
        .where(RackDevice.rack_id == rack_id)
        .options(selectinload(RackDevice.device))
        .order_by(RackDevice.ru_position)
    )
    rack_devices = result.scalars().all()

    devices = []
    for rd in rack_devices:
        device = rd.device
        devices.append({
            "id": rd.id,
            "device_id": rd.device_id,
            "ru_position": rd.ru_position,
            "ru_height": rd.ru_height,
            "device": {
                "id": device.id,
                "name": device.name,
                "ip_address": device.ip_address,
                "device_type": device.device_type,
                "vendor": device.vendor,
                "model": device.model,
                "status": device.status,
                "ssh_port": device.ssh_port,
                "rdp_port": device.rdp_port,
                "web_port": device.web_port,
            } if device else None,
        })

    return devices


@router.post("/{rack_id}/devices")
async def place_device_in_rack(
    rack_id: str,
    data: RackDevicePlace,
    session: AsyncSession = Depends(get_session),
):
    """Place a device in a rack at a specific RU position."""
    # Verify rack exists
    rack_result = await session.execute(select(Rack).where(Rack.id == rack_id))
    if not rack_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Rack not found")

    # Verify device exists
    dev_result = await session.execute(select(Device).where(Device.id == data.device_id))
    if not dev_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Device not found")

    # Check position validity
    if data.ru_position < 1:
        raise HTTPException(status_code=400, detail="RU position must be >= 1")

    # Check if device is already in this rack
    existing = await session.execute(
        select(RackDevice).where(
            RackDevice.rack_id == rack_id,
            RackDevice.device_id == data.device_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Device already in this rack")

    rack_device = RackDevice(
        rack_id=rack_id,
        device_id=data.device_id,
        ru_position=data.ru_position,
        ru_height=data.ru_height,
    )
    session.add(rack_device)
    await session.commit()
    await session.refresh(rack_device)

    return {"id": rack_device.id, "status": "placed"}


@router.put("/{rack_id}/devices/{device_id}")
async def move_device_in_rack(
    rack_id: str,
    device_id: str,
    data: RackDeviceMove,
    session: AsyncSession = Depends(get_session),
):
    """Move a device to a different RU position in the rack."""
    result = await session.execute(
        select(RackDevice).where(
            RackDevice.rack_id == rack_id,
            RackDevice.device_id == device_id,
        )
    )
    rack_device = result.scalar_one_or_none()
    if not rack_device:
        raise HTTPException(status_code=404, detail="Device not found in this rack")

    rack_device.ru_position = data.ru_position
    await session.commit()
    return {"id": rack_device.id, "status": "moved"}


@router.delete("/{rack_id}/devices/{device_id}")
async def remove_device_from_rack(
    rack_id: str,
    device_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Remove a device from a rack."""
    result = await session.execute(
        select(RackDevice).where(
            RackDevice.rack_id == rack_id,
            RackDevice.device_id == device_id,
        )
    )
    rack_device = result.scalar_one_or_none()
    if not rack_device:
        raise HTTPException(status_code=404, detail="Device not found in this rack")

    await session.delete(rack_device)
    await session.commit()
    return {"status": "removed"}
