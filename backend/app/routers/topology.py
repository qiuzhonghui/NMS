"""Topology API routes."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_session
from ..models.topology import TopologyEdge, TopologyNode

router = APIRouter(prefix="/topology", tags=["topology"])


class NodeCreate(BaseModel):
    device_id: str | None = None
    label: str
    node_type: str = "manual"
    x: float | None = None
    y: float | None = None
    width: int | None = None
    height: int | None = None
    image_url: str | None = None
    text_content: str | None = None
    discovery_source: str = "manual"


class NodeUpdate(BaseModel):
    label: str | None = None
    x: float | None = None
    y: float | None = None
    width: int | None = None
    height: int | None = None
    image_url: str | None = None
    text_content: str | None = None
    canvas_data: dict | None = None


class EdgeCreate(BaseModel):
    source_node_id: str
    target_node_id: str
    label: str | None = None
    edge_type: str = "wired"
    source_interface: str | None = None
    target_interface: str | None = None
    line_style: str = "solid"
    color: str | None = None
    discovery_source: str = "manual"


class EdgeUpdate(BaseModel):
    label: str | None = None
    edge_type: str | None = None
    line_style: str | None = None
    color: str | None = None
    source_interface: str | None = None
    target_interface: str | None = None
    discovery_source: str | None = None


@router.get("")
async def get_topology(
    session: AsyncSession = Depends(get_session),
):
    """Get the full topology graph (nodes and edges)."""
    nodes_result = await session.execute(select(TopologyNode))
    nodes = nodes_result.scalars().all()

    edges_result = await session.execute(select(TopologyEdge))
    edges = edges_result.scalars().all()

    return {
        "nodes": [
            {
                "id": n.id,
                "device_id": n.device_id,
                "label": n.label,
                "node_type": n.node_type,
                "x": n.x,
                "y": n.y,
                "width": n.width,
                "height": n.height,
                "image_url": n.image_url,
                "text_content": n.text_content,
                "discovery_source": n.discovery_source,
                "canvas_data": n.canvas_data,
            }
            for n in nodes
        ],
        "edges": [
            {
                "id": e.id,
                "source_node_id": e.source_node_id,
                "target_node_id": e.target_node_id,
                "label": e.label,
                "edge_type": e.edge_type,
                "discovery_source": e.discovery_source,
                "source_interface": e.source_interface,
                "target_interface": e.target_interface,
                "line_style": e.line_style,
                "color": e.color,
            }
            for e in edges
        ],
    }


@router.post("/nodes")
async def add_node(
    data: NodeCreate,
    session: AsyncSession = Depends(get_session),
):
    """Add a manual node to the topology."""
    # Auto-create nodes for devices if referenced
    if data.device_id:
        existing = await session.execute(
            select(TopologyNode).where(
                TopologyNode.device_id == data.device_id,
                TopologyNode.node_type == "device",
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Device node already exists")

    node = TopologyNode(
        device_id=data.device_id,
        label=data.label,
        node_type=data.node_type,
        x=data.x,
        y=data.y,
        width=data.width,
        height=data.height,
        image_url=data.image_url,
        text_content=data.text_content,
        discovery_source="manual",
    )
    session.add(node)
    await session.commit()
    await session.refresh(node)

    return {"id": node.id, "label": node.label, "status": "created"}


@router.put("/nodes/{node_id}")
async def update_node(
    node_id: str,
    data: NodeUpdate,
    session: AsyncSession = Depends(get_session),
):
    """Update a topology node. Manual edits always set discovery_source to manual."""
    result = await session.execute(
        select(TopologyNode).where(TopologyNode.id == node_id)
    )
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(node, key, value)

    # Manual edit takes priority over auto-discovery
    node.discovery_source = "manual"

    await session.commit()
    return {"id": node.id, "status": "updated"}


@router.delete("/nodes/{node_id}")
async def delete_node(
    node_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Delete a topology node and its connected edges."""
    result = await session.execute(
        select(TopologyNode).where(TopologyNode.id == node_id)
    )
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    # Delete connected edges
    await session.execute(
        delete(TopologyEdge).where(
            (TopologyEdge.source_node_id == node_id) |
            (TopologyEdge.target_node_id == node_id)
        )
    )

    await session.delete(node)
    await session.commit()
    return {"status": "deleted"}


@router.post("/edges")
async def add_edge(
    data: EdgeCreate,
    session: AsyncSession = Depends(get_session),
):
    """Add a topology edge between two nodes."""
    edge = TopologyEdge(
        source_node_id=data.source_node_id,
        target_node_id=data.target_node_id,
        label=data.label,
        edge_type=data.edge_type,
        discovery_source="manual",
        source_interface=data.source_interface,
        target_interface=data.target_interface,
        line_style=data.line_style,
        color=data.color,
    )
    session.add(edge)
    await session.commit()
    await session.refresh(edge)

    return {"id": edge.id, "status": "created"}


@router.put("/edges/{edge_id}")
async def update_edge(
    edge_id: str,
    data: EdgeUpdate,
    session: AsyncSession = Depends(get_session),
):
    """Update a topology edge. Manual edits set discovery_source to manual."""
    result = await session.execute(
        select(TopologyEdge).where(TopologyEdge.id == edge_id)
    )
    edge = result.scalar_one_or_none()
    if not edge:
        raise HTTPException(status_code=404, detail="Edge not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(edge, key, value)

    edge.discovery_source = "manual"
    await session.commit()
    return {"id": edge.id, "status": "updated"}


@router.delete("/edges/{edge_id}")
async def delete_edge(
    edge_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Delete a topology edge."""
    result = await session.execute(
        select(TopologyEdge).where(TopologyEdge.id == edge_id)
    )
    edge = result.scalar_one_or_none()
    if not edge:
        raise HTTPException(status_code=404, detail="Edge not found")

    await session.delete(edge)
    await session.commit()
    return {"status": "deleted"}


import asyncio

# 保留后台任务引用，避免被 GC 回收；任务完成后自动清理
_discovery_tasks: set[asyncio.Task] = set()


@router.post("/discover")
async def run_topology_discovery(
    session: AsyncSession = Depends(get_session),
):
    """Run CDP/LLDP topology discovery on all SNMP-enabled devices."""
    task = asyncio.create_task(_run_topology_discovery())
    _discovery_tasks.add(task)
    task.add_done_callback(_discovery_tasks.discard)
    return {"status": "discovery_started"}


async def _run_topology_discovery() -> None:
    """Run topology discovery in background, logging failures."""
    from loguru import logger

    from ..database import async_session_factory
    from ..services.topology_discovery import TopologyDiscovery
    try:
        async with async_session_factory() as session:
            discoverer = TopologyDiscovery(session)
            await discoverer.run_discovery()
    except asyncio.CancelledError:
        raise
    except Exception as e:
        logger.error(f"Topology discovery failed: {e}")
