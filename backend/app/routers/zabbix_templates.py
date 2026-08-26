"""Zabbix Template import API routes.

Endpoints for browsing the Zabbix 7.0 template repository,
previewing conversion results, and importing templates into NMS.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from loguru import logger
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_session
from ..models.device_template import MonitoringTemplate, TemplateItem
from ..services.zabbix_repo import (
    fetch_template_yaml,
    get_cache_info,
    get_proxy,
    get_scan_logs,
    get_scan_progress,
    get_template_list,
    set_proxy,
    start_refresh,
    test_proxy_connection,
)

router = APIRouter(prefix="/zabbix-templates", tags=["zabbix-templates"])


def _get_converter():
    """Lazy import zabbix_converter (may fail if pyyaml not installed)."""
    from ..services.zabbix_converter import parse_zabbix_template, preview_conversion
    return parse_zabbix_template, preview_conversion


# ── Request/Response models ──────────────────────────────────────────────

class PreviewRequest(BaseModel):
    path: str  # e.g. "app/http_agent.yaml"


class ImportRequest(BaseModel):
    path: str
    template_name: str | None = None   # optional override name
    selected_items: list[str] | None = None  # metric_names to import (all if None)


class ProxyRequest(BaseModel):
    url: str  # proxy URL, e.g. "http://proxy:8080" or "" to clear


# ── Repo browsing ─────────────────────────────────────────────────────────

@router.get("/repo/files")
async def list_repo_files(force: bool = Query(False)):
    """List Zabbix 7.0 template files from the git repository, grouped by folder.

    Uses server-side cache. Pass force=true to trigger a background refresh.
    Frontend should then poll /repo/status for progress.
    """
    try:
        tree = await get_template_list(force_refresh=force)
        cache_info = get_cache_info()
        progress = get_scan_progress()
        return {
            "folders": {
                folder: [{"name": f["name"], "path": f["path"]} for f in files]
                for folder, files in tree.items()
            },
            "cached": cache_info["cached"],
            "cache_age_seconds": cache_info["cache_age_seconds"],
            "total_files": cache_info["total_files"],
            "scanning": progress.get("scanning", False),
        }
    except Exception as e:
        logger.error(f"Failed to fetch Zabbix repo: {e}")
        raise HTTPException(
            502, f"Failed to access Zabbix repository: {str(e)[:200]}"
        )


@router.get("/repo/status")
async def repo_scan_status():
    """Get the current scan progress + diagnostic logs."""
    progress = get_scan_progress()
    progress["logs"] = get_scan_logs()
    return progress


@router.get("/repo/proxy")
async def repo_get_proxy():
    """Get the current proxy configuration."""
    return {"proxy": get_proxy()}


@router.post("/repo/proxy")
async def repo_set_proxy(data: ProxyRequest):
    """Set or clear the HTTP proxy for accessing git.zabbix.com.

    Example: {"url": "http://proxy.company.com:8080"}
    To clear: {"url": ""}
    """
    result = set_proxy(data.url if data.url else None)
    return result


@router.post("/repo/test-connection")
async def repo_test_connection(data: ProxyRequest | None = None):
    """Test connectivity to git.zabbix.com.

    Uses the given proxy URL, or the currently configured proxy, or direct connection.
    Returns {"ok": bool, "message": str, "using_proxy": str}
    """
    url = data.url if data and data.url else None
    return test_proxy_connection(url)


@router.get("/repo/debug-root")
async def repo_debug_root():
    """Debug: fetch and return the RAW first page of Zabbix root directory."""
    try:
        import httpx
        url = "https://git.zabbix.com/rest/api/1.0/projects/ZBX/repos/zabbix/files/templates?at=release%2F7.0"
        proxy = get_proxy()
        async with httpx.AsyncClient(timeout=25.0, proxy=proxy) if proxy else httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.get(url)
        raw = resp.text
        data = resp.json()
        children = data.get("values", [])
        result = [str(x) for x in children] if isinstance(children, list) else []
        return {
            "ok": resp.status_code == 200,
            "status_code": resp.status_code,
            "response_keys": list(data.keys()),
            "total_items": len(result),
            "has_next_page": not data.get("isLastPage", True),
            "next_page_start": data.get("nextPageStart"),
            "items": sorted(result),
            "raw_first_2000": raw[:2000],
            "using_proxy": proxy,
        }
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {str(e)[:500]}", "using_proxy": get_proxy()}


@router.post("/repo/refresh")
async def refresh_repo():
    """Start a background refresh of the Zabbix template cache. Returns immediately."""
    try:
        result = await start_refresh()
        return result
    except Exception as e:
        logger.error(f"Failed to start refresh: {e}")
        raise HTTPException(
            502, f"Failed to start refresh: {str(e)[:200]}"
        )


@router.get("/repo/file")
async def get_template_content(
    path: str = Query(..., description="Template path, e.g. app/http_agent.yaml"),
):
    """Fetch the raw YAML content of a single Zabbix template file."""
    try:
        content = await fetch_template_yaml(path)
        return {"path": path, "content": content}
    except Exception as e:
        logger.error(f"Failed to fetch template '{path}': {e}")
        raise HTTPException(
            502, f"Failed to fetch template: {str(e)[:200]}"
        )


# ── Preview ──────────────────────────────────────────────────────────────

@router.post("/preview")
async def preview_template(data: PreviewRequest):
    """Parse a Zabbix template and return a preview of the conversion.

    Shows template metadata and up to 50 converted items.
    """
    try:
        yaml_content = await fetch_template_yaml(data.path)
    except Exception as e:
        raise HTTPException(502, f"Failed to fetch template: {str(e)[:200]}")

    try:
        _, preview_conversion = _get_converter()
        preview = preview_conversion(yaml_content)
    except ValueError as e:
        raise HTTPException(422, f"Invalid Zabbix template: {str(e)}")
    except Exception as e:
        logger.error(f"Preview conversion failed for '{data.path}': {e}")
        raise HTTPException(500, f"Conversion error: {str(e)[:200]}")

    preview["source_path"] = data.path
    return preview


# ── Import ────────────────────────────────────────────────────────────────

@router.post("/import")
async def import_template(
    data: ImportRequest,
    session: AsyncSession = Depends(get_session),
):
    """Fetch, parse, convert, and save a Zabbix template to the NMS database.

    Creates a MonitoringTemplate row and TemplateItem rows for each
    converted item. Supports selective import via selected_items.
    """
    # 1. Fetch YAML
    try:
        yaml_content = await fetch_template_yaml(data.path)
    except Exception as e:
        raise HTTPException(502, f"Failed to fetch template: {str(e)[:200]}")

    # 2. Parse & convert
    try:
        parse_zabbix_template, _ = _get_converter()
        ct = parse_zabbix_template(yaml_content)
    except ValueError as e:
        raise HTTPException(422, f"Invalid Zabbix template: {str(e)}")
    except Exception as e:
        logger.error(f"Conversion failed for '{data.path}': {e}")
        raise HTTPException(500, f"Conversion error: {str(e)[:200]}")

    # 3. Determine template name
    tmpl_name = data.template_name or ct.name

    # 4. Check for duplicates
    existing = await session.execute(
        select(MonitoringTemplate).where(MonitoringTemplate.name == tmpl_name)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            409,
            f"Template '{tmpl_name}' already exists. "
            f"Delete it first or choose a different name.",
        )

    # 5. Create MonitoringTemplate
    tmpl = MonitoringTemplate(
        name=tmpl_name,
        description=ct.description,
        source="zabbix",
    )
    session.add(tmpl)
    await session.flush()  # get tmpl.id

    # 6. Filter items if selective import
    items_to_import = ct.items
    if data.selected_items:
        selected_set = set(data.selected_items)
        items_to_import = [i for i in ct.items if i.metric_name in selected_set]

    # 7. Create TemplateItem rows
    imported_count = 0
    skipped_count = 0
    for item in items_to_import:
        if not item.oid_or_key.strip():
            skipped_count += 1
            continue
        session.add(TemplateItem(
            template_id=tmpl.id,
            metric_name=item.metric_name,
            metric_type=item.metric_type,
            protocol=item.protocol,
            oid_or_key=item.oid_or_key,
            data_type=item.data_type,
            unit=item.unit,
            display_type=item.display_type,
            interval_seconds=item.interval_seconds,
            enabled=item.enabled,
        ))
        imported_count += 1

    await session.commit()
    await session.refresh(tmpl)

    logger.info(
        f"Imported Zabbix template '{tmpl_name}' (id={tmpl.id}): "
        f"{imported_count} items"
        + (f", {skipped_count} skipped (no OID)" if skipped_count else "")
    )

    return {
        "id": tmpl.id,
        "name": tmpl.name,
        "item_count": imported_count,
        "skipped_count": skipped_count,
        "source": "zabbix",
        "status": "imported",
    }


# ── Manage imported templates ─────────────────────────────────────────────

@router.get("")
async def list_imported(session: AsyncSession = Depends(get_session)):
    """List all Zabbix-imported templates."""
    # Auto-migrate: ensure source column exists
    try:
        from sqlalchemy import text
        await session.execute(text(
            "ALTER TABLE monitoring_templates ADD COLUMN source VARCHAR(50) DEFAULT 'manual'"
        ))
        await session.commit()
    except Exception:
        await session.rollback()  # column already exists, ignore
    try:
        result = await session.execute(
            select(MonitoringTemplate)
            .where(MonitoringTemplate.source == "zabbix")
            .order_by(MonitoringTemplate.name)
        )
        templates = result.scalars().all()
    except Exception as e:
        logger.warning(f"Failed to query imported templates: {e}")
        return []
    out = []
    for t in templates:
        count_result = await session.execute(
            select(func.count())
            .select_from(TemplateItem)
            .where(TemplateItem.template_id == t.id)
        )
        item_count = count_result.scalar() or 0
        out.append({
            "id": t.id,
            "name": t.name,
            "description": t.description,
            "item_count": item_count,
            "source": t.source or "zabbix",
            "created_at": t.created_at.isoformat() if t.created_at else None,
        })
    return out


@router.delete("/{template_id}")
async def delete_imported(
    template_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Delete an imported Zabbix template (cascade deletes items)."""
    t = await session.get(MonitoringTemplate, template_id)
    if not t:
        raise HTTPException(404, "Template not found")
    await session.delete(t)  # CASCADE on template_items
    await session.commit()
    logger.info(f"Deleted Zabbix-imported template '{t.name}' (id={template_id})")
    return {"status": "deleted", "id": template_id}
