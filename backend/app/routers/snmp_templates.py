"""SNMP Template management API routes — create, import MIB, manage OID items."""
import asyncio
import json as _json
from datetime import datetime as dt_now

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import async_session_factory, get_session
from ..models.device_template import (
    MibFile,
    MonitoringTemplate,
    OidTestResult,
    ParsedOid,
    TemplateItem,
)
from ..services.snmp import snmp_get
from ..utils.mib_parser import download_and_parse_mib, parse_cisco_supportlist, parse_mib_oids
from ..utils.oid_descriptions import MIB_MODULE_OIDS, _lookup_oid_desc

router = APIRouter(prefix="/snmp-templates", tags=["snmp-templates"])


class TemplateCreate(BaseModel):
    name: str
    description: str | None = None


class TemplateItemCreate(BaseModel):
    metric_name: str
    oid_or_key: str
    unit: str = ""
    display_type: str = "chart"  # chart / gauge / text / table
    interval_seconds: int = 60
    enabled: bool = True


class TemplateItemUpdate(BaseModel):
    metric_name: str | None = None
    oid_or_key: str | None = None
    unit: str | None = None
    display_type: str | None = None
    interval_seconds: int | None = None
    enabled: bool | None = None


# ── OID 测试结果存取 ───────────────────────────────────────────────────────

class ResultItem(BaseModel):
    oid: str = ""
    name: str = ""
    value: str = ""
    ip: str = ""

class SaveResultsRequest(BaseModel):
    results: list[ResultItem]

@router.post("/test-results/save")
async def save_results(data: SaveResultsRequest, session: AsyncSession = Depends(get_session)):
    from sqlalchemy import text as sqltxt
    saved = 0
    for r in data.results:
        if not r.oid: continue
        await session.execute(sqltxt("DELETE FROM oid_test_results WHERE oid = :oid"), {"oid": r.oid})
        session.add(OidTestResult(oid=r.oid, name=r.name, result_value=r.value[:1000], test_ip=r.ip))
        saved += 1
    await session.commit()
    return {"saved": saved}

@router.get("/test-results/load")
async def load_results(session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(OidTestResult).order_by(OidTestResult.tested_at.desc()))
    data = {}
    for r in result.scalars().all():
        if r.oid not in data:
            data[r.oid] = {"v": r.result_value or "", "t": r.tested_at.isoformat() if r.tested_at else ""}
    return data


# ── Template CRUD ───────────────────────────────────────────────────────────

@router.get("")
async def list_templates(session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(MonitoringTemplate).order_by(MonitoringTemplate.name))
    templates = result.scalars().all()

    # Single GROUP BY for all template item counts (avoids per-template query)
    item_counts: dict[str, int] = {}
    if templates:
        count_rows = await session.execute(
            select(TemplateItem.template_id, func.count())
            .where(TemplateItem.template_id.in_([t.id for t in templates]))
            .group_by(TemplateItem.template_id)
        )
        item_counts = {row[0]: row[1] for row in count_rows.all()}

    out = []
    for t in templates:
        out.append({"id": t.id, "name": t.name, "description": t.description,
                    "item_count": item_counts.get(t.id, 0),
                    "created_at": t.created_at.isoformat() if t.created_at else None})
    return out


@router.post("")
async def create_template(data: TemplateCreate, session: AsyncSession = Depends(get_session)):
    t = MonitoringTemplate(name=data.name, description=data.description)
    session.add(t)
    await session.commit()
    await session.refresh(t)
    return {"id": t.id, "name": t.name, "status": "created"}


@router.delete("/{template_id}")
async def delete_template(template_id: str, session: AsyncSession = Depends(get_session)):
    t = await session.get(MonitoringTemplate, template_id)
    if not t: raise HTTPException(404, "Not found")
    await session.delete(t)
    await session.commit()
    return {"status": "deleted"}


# ── Template Items ──────────────────────────────────────────────────────────

@router.get("/{template_id}/items")
async def list_items(template_id: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(TemplateItem).where(TemplateItem.template_id == template_id).order_by(TemplateItem.metric_name))
    items = result.scalars().all()
    return [{"id": i.id, "metric_name": i.metric_name, "oid_or_key": i.oid_or_key,
             "unit": i.unit, "display_type": i.display_type, "interval_seconds": i.interval_seconds,
             "enabled": i.enabled} for i in items]


@router.post("/{template_id}/items")
async def add_item(template_id: str, data: TemplateItemCreate, session: AsyncSession = Depends(get_session)):
    t = await session.get(MonitoringTemplate, template_id)
    if not t: raise HTTPException(404, "Template not found")
    item = TemplateItem(
        template_id=template_id, metric_name=data.metric_name, oid_or_key=data.oid_or_key,
        unit=data.unit, display_type=data.display_type, interval_seconds=data.interval_seconds,
        enabled=data.enabled, protocol="snmp", metric_type="custom", data_type="gauge")
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return {"id": item.id, "status": "added"}


@router.put("/{template_id}/items/{item_id}")
async def update_item(template_id: str, item_id: str, data: TemplateItemUpdate, session: AsyncSession = Depends(get_session)):
    item = await session.get(TemplateItem, item_id)
    if not item or item.template_id != template_id: raise HTTPException(404, "Not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    await session.commit()
    return {"status": "updated"}


@router.delete("/{template_id}/items/{item_id}")
async def delete_item(template_id: str, item_id: str, session: AsyncSession = Depends(get_session)):
    item = await session.get(TemplateItem, item_id)
    if not item or item.template_id != template_id: raise HTTPException(404, "Not found")
    await session.delete(item)
    await session.commit()
    return {"status": "deleted"}


# ── MIB Import ──────────────────────────────────────────────────────────────

@router.post("/{template_id}/import-cisco-list")
async def import_cisco_list(template_id: str, file: UploadFile = File(...), session: AsyncSession = Depends(get_session)):
    """上传 Cisco MIB 支持列表 HTML，流式下载并解析 MIB，返回 JSON 行格式的实时进度。"""
    import json as _json

    t = await session.get(MonitoringTemplate, template_id)
    if not t: raise HTTPException(404, "Template not found")

    async def stream_progress():
        import asyncio as aio
        loop = aio.get_event_loop()

        content = (await file.read()).decode('utf-8', errors='replace')
        yield _json.dumps({"log": f"文件上传成功，大小 {len(content)} 字节"}) + '\n'
        yield _json.dumps({"log": "正在解析 HTML 文件，提取 MIB 链接..."}) + '\n'
        yield _json.dumps({"stat": "Parsing HTML..."}) + '\n'

        mib_list = parse_cisco_supportlist(content)

        if not mib_list:
            yield _json.dumps({"log": "ERROR: 未找到任何 MIB 文件链接", "done": True, "stat": "No MIB URLs found"}) + '\n'
            return

        yield _json.dumps({"log": f"发现 {len(mib_list)} 个 MIB 文件链接"}) + '\n'

        priority_keywords = ['cpu', 'memory', 'entity-sensor', 'envmon', 'process-mib',
            'interface', 'ip-mib', 'tcp', 'udp', 'snmp', 'if-mib', 'system',
            'cisco-process', 'cisco-memory', 'cisco-envmon', 'cisco-cpu']
        priority_mibs = [m for m in mib_list if any(kw in m['name'].lower() for kw in priority_keywords)]
        other_mibs = [m for m in mib_list if m not in priority_mibs]
        to_download = (priority_mibs + other_mibs)[:30]

        yield _json.dumps({"log": f"开始下载 {len(to_download)} 个 MIB 文件"}) + '\n'
        yield _json.dumps({"stat": f"Downloading {len(to_download)} MIBs..."}) + '\n'

        all_oids: dict[str, str] = {}
        success = 0; failed = 0
        for i, mib in enumerate(to_download):
            yield _json.dumps({"log": f"[{i+1}/{len(to_download)}] 下载: {mib['name']} ..."}) + '\n'
            try:
                # 在线程池中执行阻塞的 HTTP 下载，避免卡住 event loop
                oids = await loop.run_in_executor(None, download_and_parse_mib, mib['url'])
                new_count = 0
                for name, oid in oids.items():
                    if oid and oid not in all_oids.values():
                        all_oids[name] = oid; new_count += 1
                        # 持久化到数据库
                        zh, en = _lookup_oid_desc(oid, name)
                        existing_oid = await session.execute(select(ParsedOid).where(ParsedOid.oid == oid))
                        if not existing_oid.scalar_one_or_none():
                            session.add(ParsedOid(oid=oid, name=name, description_zh=zh, description_en=en, mib_source=mib['name']))
                if new_count > 0:
                    yield _json.dumps({"log": f"  ✓ {mib['name']} — {len(oids)} OIDs, +{new_count}"}) + '\n'
                else:
                    yield _json.dumps({"log": f"  ✗ {mib['name']} — 未解析到 OID"}) + '\n'
                success += 1
            except Exception as e:
                yield _json.dumps({"log": f"  ✗ {mib['name']} — {str(e)[:80]}"}) + '\n'
                failed += 1
            yield _json.dumps({"stat": f"Done: {success} ok, {failed} fail | OIDs: {len(all_oids)}"}) + '\n'

        await session.commit()
        yield _json.dumps({"log": f"\n总计: {len(mib_list)} MIBs, 下载 {len(to_download)}, 成功 {success}, 失败 {failed}, 获取 {len(all_oids)} 个 OID"}) + '\n'
        oid_list = [{"name": n, "oid": o, "desc_zh": _lookup_oid_desc(o, n)[0] or "", "desc_en": _lookup_oid_desc(o, n)[1] or ""} for n, o in all_oids.items()]
        yield _json.dumps({"done": True, "stat": f"Done: {len(to_download)} MIBs, {len(all_oids)} OIDs",
                           "oids": oid_list, "oids_found": len(all_oids), "mibs_found": len(mib_list)}) + '\n'

    return StreamingResponse(stream_progress(), media_type="application/x-ndjson")


@router.post("/{template_id}/import-mib")
async def import_mib(template_id: str, file: UploadFile = File(...), session: AsyncSession = Depends(get_session)):
    t = await session.get(MonitoringTemplate, template_id)
    if not t: raise HTTPException(404, "Template not found")

    content = (await file.read()).decode('utf-8', errors='replace')
    oids = parse_mib_oids(content)

    # Return OID list for frontend selection — don't auto-add
    oid_list = [{"name": name, "oid": oid} for name, oid in oids.items()]
    logger.info(f"MIB import: {len(oid_list)} OIDs parsed from {file.filename}")
    return {"template_id": template_id, "oids_found": len(oid_list), "oids": oid_list, "added": 0}


# ── Apply template to device ────────────────────────────────────────────────

class ApplyRequest(BaseModel):
    device_ids: list[str]


@router.get("/oid-search")
async def search_oids(q: str = "", session: AsyncSession = Depends(get_session)):
    """搜索已解析的 OID 数据库。"""
    result = await session.execute(
        select(ParsedOid).where(
            (ParsedOid.name.contains(q)) | (ParsedOid.oid.contains(q)) |
            (ParsedOid.description_zh.contains(q)) | (ParsedOid.description_en.contains(q))
        ).order_by(ParsedOid.name).limit(500))
    oids = result.scalars().all()
    return [{"id": o.id, "oid": o.oid, "name": o.name,
             "desc_zh": o.description_zh or "", "desc_en": o.description_en or "",
             "mib_source": o.mib_source} for o in oids]


# ── MIB 关联 ───────────────────────────────────────────────────────────────

class AssociateMibsRequest(BaseModel):
    mib_file_ids: list[str] = []
    cisco_list_ids: list[str] = []


@router.put("/{template_id}/associate-mibs")
async def associate_mibs(template_id: str, data: AssociateMibsRequest, session: AsyncSession = Depends(get_session)):
    """关联 MIB 文件和 Cisco 支持列表到模板。"""
    t = await session.get(MonitoringTemplate, template_id)
    if not t:
        raise HTTPException(404, "Template not found")
    t.mib_file_ids = data.mib_file_ids
    t.cisco_list_ids = data.cisco_list_ids
    await session.commit()
    logger.info(f"Template {t.name}: associated {len(data.mib_file_ids)} MIBs, {len(data.cisco_list_ids)} Cisco lists")
    return {"status": "ok", "mib_file_ids": data.mib_file_ids, "cisco_list_ids": data.cisco_list_ids}


def _resolve_json_ids(val) -> list:
    """将 JSON 列值统一解析为 list。"""
    if not val:
        return []
    if isinstance(val, list):
        return val
    if isinstance(val, str):
        try:
            return _json.loads(val)
        except Exception:
            return []
    return []


@router.get("/{template_id}/available-oids")
async def get_template_available_oids(template_id: str, session: AsyncSession = Depends(get_session)):
    """获取模板关联的 MIB 文件中可用的 OID 列表（带描述），用于添加监控项。"""
    t = await session.get(MonitoringTemplate, template_id)
    if not t:
        raise HTTPException(404, "Template not found")

    all_oids = []
    seen = set()

    mib_ids = _resolve_json_ids(t.mib_file_ids)
    cisco_ids = _resolve_json_ids(t.cisco_list_ids)

    all_file_ids = list(mib_ids) + list(cisco_ids)

    for fid in all_file_ids:
        f = await session.get(MibFile, fid)
        if f and f.parsed_oids:
            for o in f.parsed_oids:
                oid = o.get("oid", "")
                if oid and oid not in seen:
                    seen.add(oid)
                    po_result = await session.execute(select(ParsedOid).where(ParsedOid.oid == oid))
                    po = po_result.scalar_one_or_none()
                    all_oids.append({
                        "oid": oid,
                        "name": o.get("name", ""),
                        "desc_zh": po.description_zh if po else "",
                        "desc_en": po.description_en if po else "",
                        "mib_source": f.filename
                    })

    return all_oids


# ── 获取模板详情（含关联 MIB 信息） ──────────────────────────────────────────

@router.get("/{template_id}")
async def get_template(template_id: str, session: AsyncSession = Depends(get_session)):
    """获取模板详情，包括关联的 MIB 文件。"""
    t = await session.get(MonitoringTemplate, template_id)
    if not t:
        raise HTTPException(404, "Template not found")

    # 计数 items
    count_result = await session.execute(
        select(func.count()).select_from(TemplateItem).where(TemplateItem.template_id == t.id))
    item_count = count_result.scalar() or 0

    # 获取关联的 MIB 文件列表
    mib_files = []
    mib_ids = _resolve_json_ids(t.mib_file_ids)
    for fid in mib_ids:
        f = await session.get(MibFile, fid)
        if f:
            mib_files.append({"id": f.id, "filename": f.filename, "oid_count": f.oid_count})

    cisco_lists = []
    cisco_ids = _resolve_json_ids(t.cisco_list_ids)
    for fid in cisco_ids:
        f = await session.get(MibFile, fid)
        if f:
            cisco_lists.append({"id": f.id, "filename": f.filename, "mib_count": f.mib_count, "oid_count": f.oid_count})

    return {
        "id": t.id, "name": t.name, "description": t.description,
        "item_count": item_count,
        "mib_file_ids": mib_ids, "mib_files": mib_files,
        "cisco_list_ids": cisco_ids, "cisco_lists": cisco_lists,
        "created_at": t.created_at.isoformat() if t.created_at else None
    }


class TestOidRequest(BaseModel):
    oid: str
    name: str = ""
    ip: str
    port: int = 161
    community: str = "public"
    version: str = "2c"


class BatchTestRequest(BaseModel):
    oids: list[dict] = []
    ip: str
    port: int = 161
    community: str = "public"
    version: str = "2c"
    concurrency: int = 20
    file_id: str = ""  # 可选：只测试指定 MibFile 的 OID


_batch_state = {"running": False, "done": 0, "total": 0, "started_at": None, "finished_at": None}


@router.post("/batch-test-oid")
async def batch_test_oid(data: BatchTestRequest):
    """启动后台批量测试，立即返回。"""
    global _batch_state
    if _batch_state.get("running"):
        return {"status": "error", "message": "Test already running"}
    _batch_state = {"running": True, "done": 0, "total": 0, "started_at": dt_now.utcnow().isoformat(), "finished_at": None}
    asyncio.ensure_future(_run_batch_bg(data))
    return {"status": "ok", "message": "Test started"}


@router.get("/test-results/status")
async def batch_test_status():
    return _batch_state


async def _run_batch_bg(data: BatchTestRequest):
    global _batch_state
    try:
        from sqlalchemy import text as sqltxt
        oids_to_test = data.oids
        if not oids_to_test:
            async with async_session_factory() as s:
                if data.file_id:
                    mf = await s.get(MibFile, data.file_id)
                    if mf and mf.parsed_oids:
                        oids_to_test = [{"oid": o.get("oid",""), "name": o.get("name","")} for o in mf.parsed_oids if o.get("oid")]
                if not oids_to_test:
                    r = await s.execute(select(ParsedOid.oid, ParsedOid.name))
                    oids_to_test = [{"oid": row[0], "name": row[1]} for row in r.fetchall() if row[0]]
        total = len(oids_to_test)
        concurrency = min(data.concurrency, total, 30)
        _batch_state = {"running": True, "done": 0, "total": total}
        lock = asyncio.Lock()

        async def run_one(idx):
            item = oids_to_test[idx]
            oid = str(item.get("oid","")).strip()
            name = str(item.get("name","")); orig = oid
            if not all(c.isdigit() or c == '.' for c in oid):
                parts = oid.split('.')
                if len(parts) >= 2 and parts[0] in MIB_MODULE_OIDS:
                    oid = MIB_MODULE_OIDS[parts[0]] + '.' + '.'.join(parts[1:])
            try:
                val = await asyncio.to_thread(snmp_get, data.ip, oid, port=data.port, community=data.community, version=data.version)
            except Exception as e:
                val = f"Err: {str(e)[:80]}"
            async with lock:
                async with async_session_factory() as s2:
                    try:
                        await s2.execute(sqltxt("DELETE FROM oid_test_results WHERE oid = :o"), {"o": orig})
                        s2.add(OidTestResult(oid=orig, name=name, result_value=str(val)[:1000], test_ip=data.ip))
                        await s2.commit()
                    except Exception: pass
            _batch_state["done"] += 1

        for batch_start in range(0, total, concurrency):
            batch = range(batch_start, min(batch_start + concurrency, total))
            await asyncio.gather(*[run_one(i) for i in batch], return_exceptions=True)
        _batch_state = {"running": False, "done": total, "total": total, "started_at": _batch_state.get("started_at"), "finished_at": dt_now.utcnow().isoformat()}
    except Exception as e:
        _batch_state = {"running": False, "done": 0, "total": 0, "error": str(e)}


@router.post("/test-oid")
async def test_oid(data: TestOidRequest, session: AsyncSession = Depends(get_session)):
    """使用 SNMP 测试单个 OID 的连通性和数据获取。"""
    oid = data.oid.strip()

    # 如果 OID 包含字母（MIB名称格式），尝试解析为数字OID
    if not all(c.isdigit() or c == '.' for c in oid):
        resolved = None
        # 1. 精确匹配 ParsedOid.name（大小写不敏感）
        from sqlalchemy import func as sqlfunc
        result = await session.execute(
            select(ParsedOid).where(sqlfunc.lower(ParsedOid.name) == oid.lower()).limit(1)
        )
        po = result.scalar_one_or_none()
        if po and po.oid and all(c.isdigit() or c == '.' for c in po.oid):
            resolved = po.oid
        else:
            # 2. 父子匹配：parentName.number → 解析 parent + .number
            parts = oid.split('.')
            if len(parts) >= 2 and not parts[-1].isdigit():
                # 最后的不是数字，可能是 multi-segment name，尝试整体匹配
                pass
            if len(parts) >= 2:
                parent = parts[0]
                tail = '.'.join(parts[1:])
                if parent in MIB_MODULE_OIDS:
                    resolved = MIB_MODULE_OIDS[parent] + '.' + tail
                else:
                    # 3. 大小写不敏感搜索父名
                    result2 = await session.execute(
                        select(ParsedOid).where(sqlfunc.lower(ParsedOid.name) == parent.lower()).limit(1)
                    )
                    po2 = result2.scalar_one_or_none()
                    if po2 and po2.oid and all(c.isdigit() or c == '.' for c in po2.oid):
                        resolved = po2.oid + '.' + tail
                    else:
                        # 4. LIKE 搜索：父名可能包含在 ParsedOid.name 中
                        result3 = await session.execute(
                            select(ParsedOid).where(
                                sqlfunc.lower(ParsedOid.name).like('%' + parent.lower() + '%')
                            ).limit(10)
                        )
                        for po3 in result3.scalars().all():
                            if po3.oid and all(c.isdigit() or c == '.' for c in po3.oid):
                                resolved = po3.oid + '.' + tail
                                break
            if not resolved:
                # 5. 全名 LIKE 搜索
                result4 = await session.execute(
                    select(ParsedOid).where(
                        sqlfunc.lower(ParsedOid.name).like('%' + oid.lower() + '%')
                    ).limit(5)
                )
                po4 = result4.scalar_one_or_none()
                if po4 and po4.oid and all(c.isdigit() or c == '.' for c in po4.oid):
                    resolved = po4.oid
        if resolved:
            oid = resolved
        # 如果无法解析，也继续用原始 OID 尝试（让 pysnmp 自行处理）
            # 无法解析也直接尝试SNMP，让pysnmp返回原始错误

    import asyncio as aio
    try:
        val = await aio.to_thread(snmp_get, data.ip, oid, port=data.port, community=data.community, version=data.version)
        return {"status": "ok", "oid": oid, "value": str(val)}
    except Exception as e:
        raise HTTPException(500, f"SNMP GET 失败: {str(e)}")


@router.post("/{template_id}/apply")
async def apply_template(template_id: str, data: ApplyRequest, session: AsyncSession = Depends(get_session)):
    from ..models.device import Device
    t = await session.get(MonitoringTemplate, template_id)
    if not t: raise HTTPException(404, "Template not found")

    applied = 0
    for did in data.device_ids:
        device = await session.get(Device, did)
        if not device: continue
        device.template_id = template_id
        applied += 1

    await session.commit()
    return {"applied": applied}
