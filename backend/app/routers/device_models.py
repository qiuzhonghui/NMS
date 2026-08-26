"""Device model and monitoring template API routes."""

from fastapi import APIRouter, Depends, HTTPException, Query
from loguru import logger
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_session
from ..models.device_template import DeviceModel, MonitoringTemplate, TemplateItem
from ..utils.snmp_profiles import PREDEFINED_MODELS

router = APIRouter(prefix="/device-models", tags=["device-models"])
template_router = APIRouter(prefix="/templates", tags=["templates"])


# ═══════════════════════════════════════════════════════════════════════════
# Device Models
# ═══════════════════════════════════════════════════════════════════════════

@router.get("")
async def list_models(
    vendor: str | None = Query(None),
    device_type: str | None = Query(None),
    category: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
):
    """List all device models, optionally filtered."""
    stmt = select(DeviceModel).order_by(DeviceModel.vendor, DeviceModel.model_name)
    if vendor:
        stmt = stmt.where(DeviceModel.vendor == vendor)
    if device_type:
        stmt = stmt.where(DeviceModel.device_type == device_type)
    if category:
        stmt = stmt.where(DeviceModel.category == category)

    result = await session.execute(stmt)
    models = result.scalars().all()

    if not models:
        return []

    return [
        {
            "id": m.id, "vendor": m.vendor, "model_name": m.model_name,
            "device_type": m.device_type, "category": m.category,
            "snmp_profile": m.snmp_profile, "icon": m.icon,
            "template_type": m.template_type, "template_ref_id": m.template_ref_id,
        }
        for m in models
    ]


class ModelCreate(BaseModel):
    vendor: str
    model_name: str
    device_type: str = "other"
    category: str = "network"
    snmp_profile: str | None = None
    template_type: str | None = None
    template_ref_id: str | None = None

class ModelUpdate(BaseModel):
    vendor: str | None = None
    model_name: str | None = None
    device_type: str | None = None
    category: str | None = None
    snmp_profile: str | None = None
    template_type: str | None = None
    template_ref_id: str | None = None

@router.post("")
async def create_model(
    data: ModelCreate,
    session: AsyncSession = Depends(get_session),
):
    """Create a new device model."""
    dm = DeviceModel(
        vendor=data.vendor, model_name=data.model_name,
        device_type=data.device_type, category=data.category,
        snmp_profile=data.snmp_profile,
        template_type=data.template_type,
        template_ref_id=data.template_ref_id,
    )
    session.add(dm)
    await session.commit()
    await session.refresh(dm)
    return {"id": dm.id, "vendor": dm.vendor, "model_name": dm.model_name, "status": "created"}


@router.put("/{model_id}")
async def update_model(model_id: str, data: ModelUpdate, session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(DeviceModel).where(DeviceModel.id == model_id))
    m = result.scalar_one_or_none()
    if not m: raise HTTPException(status_code=404, detail="Model not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(m, k, v)
    await session.commit()
    return {"status": "updated"}


@router.delete("/{model_id}")
async def delete_model(model_id: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(DeviceModel).where(DeviceModel.id == model_id))
    m = result.scalar_one_or_none()
    if not m: raise HTTPException(status_code=404, detail="Model not found")
    await session.delete(m)
    await session.commit()
    return {"status": "deleted"}


@router.get("/vendors")
async def list_vendors(session: AsyncSession = Depends(get_session)):
    """List all distinct vendors."""
    result = await session.execute(
        select(DeviceModel.vendor).distinct().order_by(DeviceModel.vendor)
    )
    return [r[0] for r in result.all()]


class SeedModelsRequest(BaseModel):
    """Request to seed predefined device models into the database."""
    overwrite: bool = False


@router.post("/seed")
async def seed_models(
    req: SeedModelsRequest = SeedModelsRequest(),
    session: AsyncSession = Depends(get_session),
):
    """Seed the database with predefined device models from snmp_profiles.py."""
    if req.overwrite:
        from sqlalchemy import delete
        await session.execute(delete(DeviceModel))

    count = 0
    for m in PREDEFINED_MODELS:
        existing = await session.execute(
            select(DeviceModel).where(
                DeviceModel.vendor == m["vendor"],
                DeviceModel.model_name == m["model_name"],
            )
        )
        if existing.scalar_one_or_none():
            continue

        dm = DeviceModel(
            vendor=m["vendor"], model_name=m["model_name"],
            device_type=m["device_type"], category=m["category"],
            snmp_profile=None,  # 不再使用内置profile
        )
        session.add(dm)
        count += 1

    await session.commit()
    logger.info(f"Seeded {count} device models")
    return {"seeded": count}


# ═══════════════════════════════════════════════════════════════════════════
# Monitoring Templates
# ═══════════════════════════════════════════════════════════════════════════

@template_router.get("")
async def list_templates(
    device_model_id: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
):
    """List all monitoring templates."""
    stmt = select(MonitoringTemplate).order_by(MonitoringTemplate.name)
    if device_model_id:
        stmt = stmt.where(MonitoringTemplate.device_model_id == device_model_id)

    result = await session.execute(stmt)
    templates = result.scalars().all()

    return [
        {
            "id": t.id, "name": t.name, "device_model_id": t.device_model_id,
            "description": t.description,
            "item_count": len(t.items) if t.items else 0,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t in templates
    ]


class TemplateCreate(BaseModel):
    name: str
    device_model_id: str | None = None
    description: str | None = None


@template_router.post("")
async def create_template(
    data: TemplateCreate,
    session: AsyncSession = Depends(get_session),
):
    """Create a new monitoring template."""
    template = MonitoringTemplate(
        name=data.name,
        device_model_id=data.device_model_id,
        description=data.description,
    )
    session.add(template)
    await session.commit()
    await session.refresh(template)
    return {"id": template.id, "name": template.name, "status": "created"}


@template_router.delete("/{template_id}")
async def delete_template(
    template_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Delete a template and its items."""
    result = await session.execute(
        select(MonitoringTemplate).where(MonitoringTemplate.id == template_id)
    )
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    await session.delete(t)
    await session.commit()
    return {"status": "deleted"}


@template_router.get("/{template_id}/items")
async def list_template_items(
    template_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Get all monitoring items in a template."""
    result = await session.execute(
        select(TemplateItem)
        .where(TemplateItem.template_id == template_id)
        .order_by(TemplateItem.metric_type, TemplateItem.metric_name)
    )
    items = result.scalars().all()

    return [
        {
            "id": i.id, "metric_name": i.metric_name, "metric_type": i.metric_type,
            "protocol": i.protocol, "oid_or_key": i.oid_or_key,
            "data_type": i.data_type, "unit": i.unit,
            "interval_seconds": i.interval_seconds, "enabled": i.enabled,
        }
        for i in items
    ]


class TemplateItemCreate(BaseModel):
    metric_name: str
    metric_type: str = "cpu"
    protocol: str = "snmp"
    oid_or_key: str | None = None
    data_type: str = "gauge"
    unit: str = "%"
    interval_seconds: int = 60
    enabled: bool = True


@template_router.post("/{template_id}/items")
async def add_template_item(
    template_id: str,
    data: TemplateItemCreate,
    session: AsyncSession = Depends(get_session),
):
    """Add a monitoring item to a template."""
    t = await session.execute(
        select(MonitoringTemplate).where(MonitoringTemplate.id == template_id)
    )
    if not t.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Template not found")

    item = TemplateItem(
        template_id=template_id,
        metric_name=data.metric_name, metric_type=data.metric_type,
        protocol=data.protocol, oid_or_key=data.oid_or_key,
        data_type=data.data_type, unit=data.unit,
        interval_seconds=data.interval_seconds, enabled=data.enabled,
    )
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return {"id": item.id, "metric_name": item.metric_name, "status": "added"}


@template_router.delete("/{template_id}/items/{item_id}")
async def delete_template_item(
    template_id: str, item_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Remove a monitoring item from a template."""
    result = await session.execute(
        select(TemplateItem).where(
            TemplateItem.id == item_id,
            TemplateItem.template_id == template_id,
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    await session.delete(item)
    await session.commit()
    return {"status": "deleted"}


@template_router.post("/{template_id}/apply/{device_id}")
async def apply_template_to_device(
    template_id: str, device_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Apply a monitoring template to a device.

    Associates the template via device.template_id and derives the
    monitoring interval from the enabled template items.  Items are shared
    (not copied) — device.monitoring_interval is set to the smallest item
    interval.
    """
    from ..models.device import Device

    device = await session.execute(select(Device).where(Device.id == device_id))
    device = device.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    items = await session.execute(
        select(TemplateItem).where(
            TemplateItem.template_id == template_id,
            TemplateItem.enabled.is_(True),
        )
    )
    items = items.scalars().all()

    device.template_id = template_id
    device.monitoring_interval = min(
        (i.interval_seconds for i in items if i.interval_seconds > 0),
        default=device.monitoring_interval
    )

    await session.commit()
    logger.info(f"Template {template_id} applied to device {device_id} ({len(items)} items)")
    return {"device_id": device_id, "template_id": template_id, "items_applied": len(items)}
