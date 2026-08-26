"""MIB 管理 API — 上传、列表、AI 分析 MIB 文件和 Cisco 支持列表。"""
import asyncio
import re
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel
from loguru import logger
import json as _json
import httpx

from ..database import get_session
from ..models.device_template import MibFile, ParsedOid, AISettings
from ..models.device import gen_uuid
from ..utils.mib_parser import parse_mib_oids, parse_cisco_supportlist, resolve_oids_second_pass, resolve_oids_with_db

router = APIRouter(prefix="/mib-manager", tags=["mib-manager"])


# ── Pydantic 模型 ───────────────────────────────────────────────────────────

class AssociateMibsRequest(BaseModel):
    """关联 MIB 文件到模板的请求。"""
    mib_file_ids: list[str] = []
    cisco_list_id: Optional[str] = None


# ── 带重试的 MIB 下载 ───────────────────────────────────────────────────────

MAX_PARALLEL = 8  # 并行下载并发数

def _download_mib_with_retry(url: str, max_retries: int = 3) -> dict[str, str]:
    """下载并解析 MIB 文件，失败自动重试（指数退避）。"""
    import urllib.request
    last_err = None
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'NMS/1.0'})
            with urllib.request.urlopen(req, timeout=15) as resp:
                content = resp.read().decode('utf-8', errors='replace')
            result = parse_mib_oids(content)
            if result:
                return result
            # 解析结果为空也算失败
            last_err = Exception("parsed 0 OIDs")
        except Exception as e:
            last_err = e
            if attempt < max_retries - 1:
                wait = (attempt + 1) * 2  # 2s, 4s, 6s
                time.sleep(wait)
    raise last_err or Exception("all retries exhausted")


# ── MIB 文件管理 ───────────────────────────────────────────────────────────

@router.get("/mib-files")
async def list_mib_files(file_type: str = "mib", session: AsyncSession = Depends(get_session)):
    """列出已上传的 MIB 文件或 Cisco 支持列表。"""
    result = await session.execute(
        select(MibFile).where(MibFile.file_type == file_type)
        .order_by(MibFile.created_at.desc())
    )
    files = result.scalars().all()
    return [{
        "id": f.id, "filename": f.filename, "file_type": f.file_type,
        "oid_count": f.oid_count, "mib_count": f.mib_count,
        "created_at": f.created_at.isoformat() if f.created_at else None
    } for f in files]


@router.post("/upload-mib")
async def upload_mib(file: UploadFile = File(...), session: AsyncSession = Depends(get_session)):
    """上传单个 MIB 文件，解析 OID 并持久化存储。"""
    content = (await file.read()).decode('utf-8', errors='replace')
    oids = parse_mib_oids(content)

    oid_list = [{"name": name, "oid": oid} for name, oid in oids.items()]
    mib_file = MibFile(
        filename=file.filename, file_type="mib",
        content=content[:50000],
        oid_count=len(oids), parsed_oids=oid_list
    )
    session.add(mib_file)

    # Batch dedupe against parsed_oids in a single query (avoids N+1)
    new_oids = [(name, oid) for name, oid in oids.items() if oid]
    if new_oids:
        existing_rows = await session.execute(
            select(ParsedOid.oid).where(ParsedOid.oid.in_([oid for _, oid in new_oids]))
        )
        existing_set = set(existing_rows.scalars().all())
        from .snmp_templates import _lookup_oid_desc
        for name, oid in new_oids:
            if oid in existing_set:
                continue
            zh, en = _lookup_oid_desc(oid, name)
            session.add(ParsedOid(oid=oid, name=name, description_zh=zh, description_en=en, mib_source=file.filename))

    await session.commit()
    await session.refresh(mib_file)
    logger.info(f"MIB upload: {file.filename} → {len(oids)} OIDs parsed")
    return {
        "id": mib_file.id, "filename": mib_file.filename, "oid_count": len(oids),
        "oids": oid_list, "status": "ok"
    }


@router.post("/upload-cisco-list")
async def upload_cisco_list(file: UploadFile = File(...), session: AsyncSession = Depends(get_session)):
    """上传 Cisco MIB 支持列表 HTML，流式下载并解析所有 MIB，返回实时进度。"""

    async def stream_progress():
        loop = asyncio.get_event_loop()

        content = (await file.read()).decode('utf-8', errors='replace')
        yield _json.dumps({"log": f"文件上传成功，大小 {len(content)} 字节"}) + '\n'
        yield _json.dumps({"log": "正在解析 HTML 文件，提取 MIB 链接..."}) + '\n'

        mib_list = parse_cisco_supportlist(content)
        if not mib_list:
            yield _json.dumps({"log": "ERROR: 未找到任何 MIB 文件链接", "done": True}) + '\n'
            return

        yield _json.dumps({"log": f"发现 {len(mib_list)} 个 MIB 文件链接"}) + '\n'

        # 保存 Cisco 支持列表记录
        cisco_file = MibFile(
            filename=file.filename, file_type="cisco_list",
            content=content[:50000], oid_count=0, mib_count=len(mib_list)
        )
        session.add(cisco_file)
        await session.commit()
        await session.refresh(cisco_file)
        yield _json.dumps({"cisco_list_id": cisco_file.id, "log": f"支持列表已保存 (ID: {cisco_file.id})"}) + '\n'

        # 优先下载关键 MIB
        priority_keywords = ['cpu', 'memory', 'entity-sensor', 'envmon', 'process-mib',
            'interface', 'ip-mib', 'tcp', 'udp', 'snmp', 'if-mib', 'system',
            'cisco-process', 'cisco-memory', 'cisco-envmon', 'cisco-cpu']
        priority_mibs = [m for m in mib_list if any(kw in m['name'].lower() for kw in priority_keywords)]
        other_mibs = [m for m in mib_list if m not in priority_mibs]
        to_download = priority_mibs + other_mibs  # 下载全部

        yield _json.dumps({"log": f"开始并行下载 {len(to_download)} 个 MIB（{MAX_PARALLEL}并发，每个最多重试3次）", "stat": f"Downloading {len(to_download)} MIBs ({MAX_PARALLEL} parallel)..."}) + '\n'

        all_oids: dict[str, str] = {}
        success, failed = 0, 0
        sem = asyncio.Semaphore(MAX_PARALLEL)

        async def dl_one(mib):
            async with sem:
                try:
                    oids = await loop.run_in_executor(None, _download_mib_with_retry, mib['url'], 3)
                    return mib, oids, None
                except Exception as e:
                    return mib, {}, str(e)

        tasks = [dl_one(m) for m in to_download]
        done_cnt = 0; total = len(to_download)
        for coro in asyncio.as_completed(tasks):
            mib, oids, err = await coro; done_cnt += 1
            if err:
                failed += 1
                yield _json.dumps({"log": f"  ✗ [{done_cnt}/{total}] {mib['name']} — {err[:60]}"}) + '\n'
            else:
                success += 1; new_count = 0
                for name, oid in oids.items():
                    if oid and oid not in all_oids:
                        all_oids[name] = oid; new_count += 1
                        from .snmp_templates import _lookup_oid_desc
                        zh, en = _lookup_oid_desc(oid, name)
                        existing_oid = await session.execute(select(ParsedOid).where(ParsedOid.oid == oid))
                        if not existing_oid.scalar_one_or_none():
                            session.add(ParsedOid(oid=oid, name=name, description_zh=zh, description_en=en, mib_source=mib['name']))
                tag = f"+{new_count}" if new_count else "no new"
                yield _json.dumps({"log": f"  ✓ [{done_cnt}/{total}] {mib['name']} — {len(oids)} OIDs, {tag}"}) + '\n'
            yield _json.dumps({"stat": f"Progress: {done_cnt}/{total} | OIDs: {len(all_oids)}"}) + '\n'

        await session.commit()

        # 第二遍解析：用已知数字OID交叉引用，解析残留的非数字OID
        yield _json.dumps({"log": "正在进行第二遍OID交叉解析..."}) + '\n'
        all_oids = resolve_oids_second_pass(all_oids)
        # 第三遍：用数据库 ParsedOid 表进一步解析
        po_map = {}
        po_result = await session.execute(select(ParsedOid).where(ParsedOid.oid.op('REGEXP')(r'^[\d.]+$')))
        for po in po_result.scalars().all():
            if po.name and po.oid:
                po_map[po.name] = po.oid
        if po_map:
            all_oids = resolve_oids_with_db(all_oids, po_map)
        resolved_count = sum(1 for o in all_oids.values() if all(c.isdigit() or c == '.' for c in o))
        yield _json.dumps({"log": f"解析完成: {resolved_count}/{len(all_oids)} 个 OID 已转为数字格式"}) + '\n'

        total_oids = len(all_oids)
        cisco_file.oid_count = total_oids
        cisco_file.parsed_oids = [{"name": n, "oid": o} for n, o in all_oids.items()]
        await session.commit()

        yield _json.dumps({"log": f"\n总计: {len(mib_list)} MIBs, 下载 {len(to_download)}, 成功 {success}, 失败 {failed}, 获取 {total_oids} 个 OID"}) + '\n'
        oid_list = [{"name": n, "oid": o} for n, o in all_oids.items()]
        yield _json.dumps({"done": True, "stat": f"Done: {len(to_download)} MIBs, {total_oids} OIDs",
                           "oids": oid_list, "oids_found": total_oids, "mibs_found": len(mib_list),
                           "cisco_list_id": cisco_file.id}) + '\n'

    return StreamingResponse(stream_progress(), media_type="application/x-ndjson")


@router.post("/reparse-cisco/{file_id}")
async def reparse_cisco_list(file_id: str, session: AsyncSession = Depends(get_session)):
    """重新解析已存储的 Cisco 支持列表 HTML，下载 MIB 并增量添加新 OID。"""
    f = await session.get(MibFile, file_id)
    if not f or f.file_type != "cisco_list":
        raise HTTPException(404, "Cisco support list not found")
    if not f.content:
        raise HTTPException(400, "原始文件内容已丢失")

    async def stream_progress():
        loop = asyncio.get_event_loop()

        yield _json.dumps({"log": f"重新解析: {f.filename}"}) + '\n'
        yield _json.dumps({"log": "正在解析 HTML，提取 MIB 链接..."}) + '\n'

        mib_list = parse_cisco_supportlist(f.content)
        if not mib_list:
            yield _json.dumps({"log": "ERROR: 未找到任何 MIB 文件链接", "done": True}) + '\n'
            return

        yield _json.dumps({"log": f"发现 {len(mib_list)} 个 MIB 链接"}) + '\n'

        # 获取已有 OID 集合
        existing_oids = set()
        if f.parsed_oids:
            for o in f.parsed_oids:
                oid = o.get("oid", "")
                if oid:
                    existing_oids.add(oid)

        yield _json.dumps({"log": f"已有 {len(existing_oids)} 个 OID，将增量添加新 OID"}) + '\n'

        priority_keywords = ['cpu', 'memory', 'entity-sensor', 'envmon', 'process-mib',
            'interface', 'ip-mib', 'tcp', 'udp', 'snmp', 'if-mib', 'system',
            'cisco-process', 'cisco-memory', 'cisco-envmon', 'cisco-cpu']
        priority_mibs = [m for m in mib_list if any(kw in m['name'].lower() for kw in priority_keywords)]
        other_mibs = [m for m in mib_list if m not in priority_mibs]
        to_download = priority_mibs + other_mibs  # 下载全部

        yield _json.dumps({"log": f"开始并行下载 {len(to_download)} 个 MIB（{MAX_PARALLEL}并发，每个最多重试3次）"}) + '\n'

        all_oids = {o.get("oid"): o for o in (f.parsed_oids or []) if o.get("oid")}
        success, failed, new_total = 0, 0, 0
        sem = asyncio.Semaphore(MAX_PARALLEL)

        async def dl_one(mib):
            async with sem:
                try:
                    oids = await loop.run_in_executor(None, _download_mib_with_retry, mib['url'], 3)
                    return mib, oids, None
                except Exception as e:
                    return mib, {}, str(e)

        tasks = [dl_one(m) for m in to_download]
        done_cnt = 0; total = len(to_download)
        for coro in asyncio.as_completed(tasks):
            mib, oids, err = await coro; done_cnt += 1
            if err:
                failed += 1
                yield _json.dumps({"log": f"  ✗ [{done_cnt}/{total}] {mib['name']} — {err[:60]}"}) + '\n'
            else:
                success += 1; new_count = 0
                for name, oid in oids.items():
                    if oid and oid not in existing_oids and oid not in all_oids:
                        all_oids[oid] = {"name": name, "oid": oid}
                        existing_oids.add(oid); new_count += 1
                        from .snmp_templates import _lookup_oid_desc
                        zh, en = _lookup_oid_desc(oid, name)
                        existing_po = await session.execute(select(ParsedOid).where(ParsedOid.oid == oid))
                        if not existing_po.scalar_one_or_none():
                            session.add(ParsedOid(oid=oid, name=name, description_zh=zh, description_en=en, mib_source=mib['name']))
                if new_count > 0:
                    yield _json.dumps({"log": f"  ✓ [{done_cnt}/{total}] {mib['name']} — +{new_count} new"}) + '\n'
                    new_total += new_count
                else:
                    yield _json.dumps({"log": f"  ✓ [{done_cnt}/{total}] {mib['name']} — (no new)"}) + '\n'
            yield _json.dumps({"stat": f"Progress: {done_cnt}/{total} | New: {new_total}"}) + '\n'

        await session.commit()

        # 第二/三遍解析
        yield _json.dumps({"log": "正在进行OID交叉解析..."}) + '\n'
        oids_dict = {o["name"]: o["oid"] for o in all_oids.values()}
        oids_dict = resolve_oids_second_pass(oids_dict)
        po_map = {}
        po_result = await session.execute(select(ParsedOid).where(ParsedOid.oid.op('REGEXP')(r'^[\d.]+$')))
        for po in po_result.scalars().all():
            if po.name and po.oid: po_map[po.name] = po.oid
        if po_map: oids_dict = resolve_oids_with_db(oids_dict, po_map)
        resolved_count = sum(1 for o in oids_dict.values() if all(c.isdigit() or c == '.' for c in o))
        yield _json.dumps({"log": f"解析完成: {resolved_count}/{len(oids_dict)} 已转数字格式"}) + '\n'

        # 重建 all_oids
        new_all = {}
        for name, oid in oids_dict.items():
            new_all[oid] = {"name": name, "oid": oid}
        all_oids = new_all

        f.parsed_oids = list(all_oids.values())
        f.oid_count = len(all_oids)
        f.mib_count = len(mib_list)
        await session.commit()

        yield _json.dumps({"log": f"\n总计: 新增 {new_total} 个 OID, 现在共 {len(all_oids)} 个"}) + '\n'
        yield _json.dumps({"done": True, "stat": f"+{new_total} new OIDs, {len(all_oids)} total",
                           "new_oids": new_total, "total_oids": len(all_oids)}) + '\n'

    return StreamingResponse(stream_progress(), media_type="application/x-ndjson")


@router.get("/mib-files/{file_id}")
async def get_mib_file(file_id: str, session: AsyncSession = Depends(get_session)):
    """获取 MIB 文件的详情，包括解析出的 OID 列表（含 ParsedOid 描述）。"""
    f = await session.get(MibFile, file_id)
    if not f:
        raise HTTPException(404, "MIB file not found")

    # 批量查询 ParsedOid（避免 N+1 查询）
    oids_with_desc = []
    if f.parsed_oids:
        # 收集所有 OID
        oid_list = [o.get("oid","") for o in f.parsed_oids if o.get("oid")]
        # 批量查询
        po_map = {}
        if oid_list:
            po_result = await session.execute(select(ParsedOid).where(ParsedOid.oid.in_(oid_list)))
            for po in po_result.scalars().all():
                po_map[po.oid] = po
        for o in f.parsed_oids:
            oid = o.get("oid", "")
            po = po_map.get(oid)
            desc_zh = po.description_zh if po and po.description_zh else ""
            desc_en = po.description_en if po and po.description_en else ""
            src = po.mib_source if po and po.mib_source else o.get("mib_source", "")
            oids_with_desc.append({"name": o.get("name",""), "oid": oid, "desc_zh": desc_zh, "desc_en": desc_en, "mib_source": src})

    return {
        "id": f.id, "filename": f.filename, "file_type": f.file_type,
        "oid_count": f.oid_count, "mib_count": f.mib_count,
        "parsed_oids": oids_with_desc,
        "created_at": f.created_at.isoformat() if f.created_at else None
    }


@router.delete("/mib-files/{file_id}")
async def delete_mib_file(file_id: str, session: AsyncSession = Depends(get_session)):
    """删除 MIB 文件或 Cisco 支持列表。"""
    f = await session.get(MibFile, file_id)
    if not f:
        raise HTTPException(404, "Not found")
    await session.delete(f)
    await session.commit()
    return {"status": "deleted"}


# ── AI 分析（流式进度） ────────────────────────────────────────────────────

def _build_ai_payload(ai_config: AISettings, system_prompt: str, user_prompt: str) -> dict:
    """构建 AI API 请求体，兼容多种 provider。"""
    payload = {
        "model": ai_config.model_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.3,
    }
    # 仅 OpenAI 和兼容 provider 使用 response_format
    if ai_config.provider in ("openai", "azure", "custom"):
        payload["response_format"] = {"type": "json_object"}
    return payload


def _extract_json(text: str) -> dict:
    """从 AI 返回文本中提取 JSON，兼容截断/不完整输出。"""
    # 直接解析
    try:
        return _json.loads(text)
    except _json.JSONDecodeError:
        pass
    # 提取 ```json ... ``` 代码块
    m = re.search(r'```(?:json)?\s*([\s\S]*?)```', text)
    if m:
        try:
            return _json.loads(m.group(1))
        except _json.JSONDecodeError:
            pass
    # 提取最外层 {...}，尝试修复截断
    m = re.search(r'\{[\s\S]*', text)
    if m:
        json_str = m.group()
        # 如果 JSON 被截断，尝试补全
        results = _try_recover_results(json_str)
        if results:
            return {"results": results}
    raise ValueError(f"无法从 AI 返回中提取 JSON: {text[:200]}")


def _try_recover_results(json_str: str) -> list | None:
    """尝试从截断的 JSON 中恢复已完成的 OID 条目。"""
    # 用正则逐个提取已完成的对象: {"oid": "...", "name": "...", ...}
    # 匹配完整的 results 数组元素
    entries = []
    pos = 0
    while True:
        # 找下一个 "oid" 或 "name"/"n" 字段
        m = re.search(r'\{\s*"(?:oid|name|n)"\s*:\s*"([^"]*)"', json_str[pos:])
        if not m:
            break
        # 从这个 { 开始，尝试提取完整对象
        start = json_str.rfind('{', 0, pos + m.start()) if pos + m.start() < len(json_str) else -1
        if start < 0:
            start = json_str.find('{', pos + m.start())
        if start < 0:
            break
        # 找匹配的 }
        depth = 0
        end = -1
        for i in range(start, len(json_str)):
            if json_str[i] == '{': depth += 1
            elif json_str[i] == '}':
                depth -= 1
                if depth == 0:
                    end = i
                    break
        if end < 0:
            break  # 未闭合的对象，说明截断了
        try:
            obj = _json.loads(json_str[start:end+1])
            entries.append(obj)
        except _json.JSONDecodeError:
            pass
        pos = end + 1
    return entries if entries else None


@router.post("/analyze-mib/{file_id}")
async def analyze_mib(file_id: str, session: AsyncSession = Depends(get_session)):
    """流式 AI 分析 MIB 文件中的 OID，实时返回进度和结果。"""
    f = await session.get(MibFile, file_id)
    if not f:
        raise HTTPException(404, "MIB file not found")

    ai_result = await session.execute(select(AISettings).limit(1))
    ai_config = ai_result.scalar_one_or_none()
    if not ai_config or not ai_config.enabled:
        raise HTTPException(400, "AI 未配置或未启用，请先在设置中配置 AI")
    if not ai_config.api_key or len(ai_config.api_key) < 4:
        raise HTTPException(400, "AI API Key 未配置")

    # 获取 OID 列表
    oids = f.parsed_oids or []
    if not oids and f.content:
        parsed = parse_mib_oids(f.content)
        oids = [{"name": name, "oid": oid} for name, oid in parsed.items()]
        f.parsed_oids = oids
        f.oid_count = len(oids)
        await session.commit()

    if not oids:
        raise HTTPException(400, "该 MIB 文件中未解析到 OID")

    async def stream_progress():
        # 增量模式：跳过已有描述的 OID
        existing_count = 0
        incremental_oids = []
        for o in oids:
            oid_val = o.get("oid", "")
            if oid_val:
                po_result = await session.execute(select(ParsedOid).where(ParsedOid.oid == oid_val))
                po = po_result.scalar_one_or_none()
                if po and (po.description_zh or po.description_en):
                    existing_count += 1
                else:
                    incremental_oids.append(o)
            else:
                incremental_oids.append(o)

        oids_to_analyze = incremental_oids
        if existing_count > 0:
            yield _json.dumps({"log": f"增量模式: {existing_count} 个 OID 已有描述（跳过），{len(oids_to_analyze)} 个待分析"}) + '\n'

        if not oids_to_analyze:
            yield _json.dumps({"log": "所有 OID 均已有描述，无需分析", "done": True, "stat": "All OIDs already analyzed"}) + '\n'
            return

        batch_size = ai_config.batch_size or 100
        concurrency = ai_config.ai_concurrency or 3
        req_timeout = ai_config.request_timeout or 120
        grp_timeout = ai_config.group_timeout or 180
        total_batches = (len(oids_to_analyze) + batch_size - 1) // batch_size
        yield _json.dumps({"log": f"共 {len(oids_to_analyze)} 个 OID，分 {total_batches} 轮（{batch_size}/轮，{concurrency}并发）", "stat": f"Batch 0/{total_batches}"}) + '\n'

        system_prompt = """SNMP MIB OID 分析。返回 JSON: {"results":[{"oid":"1.2.3","n":"ifName","zh":"接口名称","en":"Interface name","u":"","d":"text","i":"medium"}]}
字段: zh=中文描述(≤20字), en=英文描述(≤10词), u=建议单位(%/bytes/packets/s/°C/""), d=展示(chart/gauge/text/table), i=重要度(high/medium/low)。zh和en必填，u/d/i可选。只返回JSON不要其他文字。"""

        total_analyzed = 0
        total_updated = 0
        all_results = []
        start_time = time.time()
        lock = asyncio.Lock()
        next_batch = 0
        running_slots = {}

        async def worker(slot_id):
            """单个并发窗口：不断取下一批，调用AI，存DB，重复直到全部完成。"""
            nonlocal next_batch, total_analyzed, total_updated
            while True:
                async with lock:
                    if next_batch >= total_batches:
                        return
                    bi = next_batch
                    next_batch += 1
                    running_slots[slot_id] = bi

                batch_oids = oids_to_analyze[bi * batch_size: (bi + 1) * batch_size]
                oid_lines = "\n".join([f"{o['oid']} {o['name']}" for o in batch_oids])
                user_prompt = f"批次{bi+1}/{total_batches}\n{oid_lines}"
                payload = _build_ai_payload(ai_config, system_prompt, user_prompt)

                t0 = time.time()
                try:
                    async with httpx.AsyncClient(timeout=float(req_timeout)) as client:
                        resp = await client.post(
                            f"{ai_config.api_base}/chat/completions",
                            headers={"Authorization": f"Bearer {ai_config.api_key}", "Content-Type": "application/json"},
                            json=payload
                        )
                    elapsed = time.time() - t0
                    if resp.status_code != 200:
                        yield _json.dumps({"log": f"[窗口{slot_id}] ✗ #{bi+1}: HTTP{resp.status_code} ({elapsed:.0f}s)", "slot": slot_id, "status": "error"}) + '\n'
                        continue
                    data = resp.json(); ai_text = data.get("choices",[{}])[0].get("message",{}).get("content","")
                    if not ai_text:
                        yield _json.dumps({"log": f"[窗口{slot_id}] ✗ #{bi+1}: 空响应", "slot": slot_id, "status": "error"}) + '\n'
                        continue
                    try:
                        parsed = _extract_json(ai_text)
                    except ValueError:
                        yield _json.dumps({"log": f"[窗口{slot_id}] ✗ #{bi+1}: JSON解析失败 ({elapsed:.0f}s)", "slot": slot_id, "status": "error"}) + '\n'
                        continue
                    results = parsed.get("results",[])
                    if not results:
                        yield _json.dumps({"log": f"[窗口{slot_id}] ⚠ #{bi+1}: 无结果 ({elapsed:.0f}s)", "slot": slot_id, "status": "warn"}) + '\n'
                        continue

                    updated = 0; session.autoflush = False
                    for r in results:
                        oid_val = r.get("oid","")
                        if oid_val:
                            name = r.get("n") or r.get("name","")
                            desc_zh = r.get("zh") or r.get("description_zh","")
                            desc_en = r.get("en") or r.get("description_en","")
                            from sqlalchemy import text
                            await session.execute(
                                text("INSERT INTO parsed_oids (id, oid, name, description_zh, description_en, mib_source, created_at) "
                                     "VALUES (:id, :oid, :name, :zh, :en, :src, NOW()) "
                                     "ON DUPLICATE KEY UPDATE "
                                     "description_zh = IF(:zh2 != '', :zh2, description_zh), "
                                     "description_en = IF(:en2 != '', :en2, description_en)"),
                                {"id": gen_uuid(), "oid": oid_val, "name": name, "zh": desc_zh, "en": desc_en, "src": f.filename,
                                 "zh2": desc_zh, "en2": desc_en}
                            )
                            updated += 1
                    session.autoflush = True
                    try:
                        await session.commit()
                    except Exception:
                        await session.rollback()
                        await session.begin()  # 重新开始事务，避免后续操作失败

                    async with lock:
                        total_analyzed += len(results); total_updated += updated
                    all_results.extend(results)
                    yield _json.dumps({"log": f"[窗口{slot_id}] ✓ #{bi+1}: {len(results)}条 +{updated} ({elapsed:.0f}s)", "slot": slot_id, "batch": bi+1, "total": total_batches, "status": "done", "results": len(results), "total_analyzed": total_analyzed}) + '\n'
                except Exception as e:
                    yield _json.dumps({"log": f"[窗口{slot_id}] ✗ #{bi+1}: {str(e)[:60]}", "slot": slot_id, "status": "error"}) + '\n'
                finally:
                    async with lock:
                        running_slots.pop(slot_id, None)

        # 启动 N 个 worker，通过 Queue 收集输出
        q = asyncio.Queue()
        async def worker_wrapper(sid):
            async for msg in worker(sid):
                await q.put(msg)

        worker_tasks = [asyncio.ensure_future(worker_wrapper(i+1)) for i in range(concurrency)]
        yield _json.dumps({"log": f"{concurrency} 个并发窗口已启动，流水线处理中...", "stat": f"0/{total_batches}"}) + '\n'

        done_workers = 0
        while done_workers < concurrency:
            try:
                msg = await asyncio.wait_for(q.get(), timeout=20.0)
                yield msg
            except asyncio.TimeoutError:
                active = sorted(running_slots.keys())
                elapsed = int(time.time() - start_time)
                yield _json.dumps({"log": f"  ... {elapsed}s | 活跃窗口: {active} | 进度: {total_analyzed}条/{len(oids_to_analyze)}", "heartbeat": True}) + '\n'
            done_workers = sum(1 for t in worker_tasks if t.done())

        await asyncio.gather(*worker_tasks, return_exceptions=True)

        total_elapsed = time.time() - start_time
        yield _json.dumps({"log": f"\n✓ 全部完成! {total_batches} 轮, {total_analyzed} 条分析, {total_updated} 条更新, 总耗时 {total_elapsed:.1f}s"}) + '\n'
        yield _json.dumps({"done": True, "stat": f"Done: {total_analyzed} analyzed, {total_updated} updated",
                           "results": all_results, "analyzed": total_analyzed, "updated": total_updated}) + '\n'

    return StreamingResponse(stream_progress(), media_type="application/x-ndjson")


@router.post("/analyze-oid")
async def analyze_single_oid(request: dict, session: AsyncSession = Depends(get_session)):
    """AI 分析单条 OID 的作用。"""
    oid = request.get("oid", "")
    name = request.get("name", "")

    ai_result = await session.execute(select(AISettings).limit(1))
    ai_config = ai_result.scalar_one_or_none()
    if not ai_config or not ai_config.enabled:
        raise HTTPException(400, "AI 未配置或未启用")

    system_prompt = """SNMP OID分析。返回JSON: {"zh":"中文描述","en":"English desc","u":"单位","d":"chart/gauge/text/table","i":"high/medium/low"}。只返回JSON。"""

    payload = _build_ai_payload(ai_config, system_prompt, f"OID: {oid}\nName: {name}")

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{ai_config.api_base}/chat/completions",
                headers={
                    "Authorization": f"Bearer {ai_config.api_key}",
                    "Content-Type": "application/json"
                },
                json=payload
            )
            if resp.status_code != 200:
                raise HTTPException(502, f"AI API error: {resp.status_code}")

            data = resp.json()
            ai_text = data.get("choices", [{}])[0].get("message", {}).get("content", "{}")
            ai_result_data = _extract_json(ai_text)

            existing = await session.execute(select(ParsedOid).where(ParsedOid.oid == oid))
            po = existing.scalar_one_or_none()
            if po:
                po.description_zh = ai_result_data.get("zh") or ai_result_data.get("description_zh", po.description_zh)
                po.description_en = ai_result_data.get("en") or ai_result_data.get("description_en", po.description_en)
            await session.commit()

            return {"status": "ok", "result": ai_result_data}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"AI 分析失败: {str(e)}")


# ── 获取 MIB 中可用于模板的 OID ────────────────────────────────────────────

@router.get("/available-oids")
async def get_available_oids(
    mib_file_ids: str = Query("", description="逗号分隔的 MIB 文件 ID"),
    session: AsyncSession = Depends(get_session)
):
    """获取指定 MIB 文件中解析出的 OID 列表（带描述），供模板添加监控项时选择。"""
    ids = [i.strip() for i in mib_file_ids.split(",") if i.strip()]
    if not ids:
        return []

    all_oids = []
    seen = set()

    # 先收集所有候选 OID（去重），再一次性查询 ParsedOid 描述（避免 N+1）
    oid_meta: dict[str, dict] = {}
    for fid in ids:
        f = await session.get(MibFile, fid)
        if f and f.parsed_oids:
            for o in f.parsed_oids:
                oid = o.get("oid", "")
                if oid and oid not in seen:
                    seen.add(oid)
                    oid_meta[oid] = {"name": o.get("name", ""), "mib_source": f.filename}

    desc_map = {}
    if oid_meta:
        po_rows = await session.execute(
            select(ParsedOid).where(ParsedOid.oid.in_(list(oid_meta.keys())))
        )
        desc_map = {po.oid: po for po in po_rows.scalars().all()}

    for oid, meta in oid_meta.items():
        po = desc_map.get(oid)
        all_oids.append({
            "oid": oid,
            "name": meta["name"],
            "desc_zh": po.description_zh if po else "",
            "desc_en": po.description_en if po else "",
            "mib_source": meta["mib_source"]
        })

    return all_oids
