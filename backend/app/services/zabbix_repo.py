"""Zabbix 7.0 template repository reader with in-memory cache.

Key insight from real-world testing:
- The Bitbucket API's /files/templates endpoint returns FLAT file paths
  (e.g., "app/acronis/template.yaml"), NOT just child names
- The root call is PAGINATED (25 items/page, uses nextPageStart)
- Subfolder calls (e.g., /files/templates/app) return immediate children
"""
import asyncio
import json
import time
from pathlib import Path

import httpx
from loguru import logger

ZABBIX_BASE = "https://git.zabbix.com"
ZABBIX_PROJECT = "ZBX"
ZABBIX_REPO = "zabbix"
ZABBIX_BRANCH = "release/7.0"
CACHE_TTL = 3600

_data_dir = Path(__file__).resolve().parent.parent.parent / "data"
_data_dir.mkdir(parents=True, exist_ok=True)
_PROXY_FILE = _data_dir / "zabbix_proxy.json"
_CACHE_FILE = _data_dir / "zabbix_cache.json"

_cache: dict = {"data": None, "fetched_at": 0}
_scan_progress: dict | None = None
_scan_logs: list[dict] = []

# Proxy
_proxy_url: str | None = None


# ── File type helpers ──────────────────────────────────────────────────────

def _is_yaml(name: str) -> bool:
    return name.endswith(".yaml") or name.endswith(".yml")


_NON_YAML_EXT = {".md", ".txt", ".xml", ".json", ".csv", ".html",
                 ".png", ".jpg", ".jpeg", ".gif", ".svg", ".pdf",
                 ".py", ".sh", ".js", ".css", ".zip", ".tar", ".gz"}

def _is_junk_file(name: str) -> bool:
    """Check if a file is a known non-template file (README, etc)."""
    lower = name.lower()
    for ext in _NON_YAML_EXT:
        if lower.endswith(ext):
            return True
    return False


# ── Proxy ──────────────────────────────────────────────────────────────────

def _load_proxy():
    global _proxy_url
    try:
        if _PROXY_FILE.exists():
            _proxy_url = json.loads(_PROXY_FILE.read_text("utf-8")).get("proxy")
    except Exception:
        _proxy_url = None

_load_proxy()

def set_proxy(url: str | None) -> dict:
    global _proxy_url
    url = (url or "").strip()
    if url:
        parts = [p.strip() for p in url.replace("\n", " ").split(" ") if p.strip()]
        url = parts[0]
        if "://" not in url:
            url = "http://" + url
        _proxy_url = url
    else:
        _proxy_url = None
    _PROXY_FILE.parent.mkdir(parents=True, exist_ok=True)
    json.dump({"proxy": _proxy_url, "updated_at": time.time()}, _PROXY_FILE.open("w", encoding="utf-8"), indent=2)
    logger.info(f"Proxy: {_proxy_url or 'DIRECT'}")
    ok, msg = _test_proxy(url) if url else (True, "cleared")
    return {"proxy": _proxy_url, "test_result": msg, "test_ok": ok}

def get_proxy() -> str | None:
    return _proxy_url

def test_proxy_connection(url: str | None = None) -> dict:
    p = url or _proxy_url
    test_url = f"{ZABBIX_BASE}/rest/api/1.0/projects/ZBX/repos/zabbix/files/templates/app?at=release%2F7.0"
    try:
        resp = httpx.get(test_url, proxy=p, timeout=10.0) if p else httpx.get(test_url, timeout=10.0)
        return {"ok": resp.status_code == 200, "message": f"HTTP {resp.status_code}, {len(resp.text)} bytes", "using_proxy": p}
    except Exception as e:
        return {"ok": False, "message": f"{type(e).__name__}: {e}", "using_proxy": p}

def _test_proxy(url: str) -> tuple[bool, str]:
    try:
        resp = httpx.get(
            f"{ZABBIX_BASE}/rest/api/1.0/projects/ZBX/repos/zabbix/files/templates/app?at=release%2F7.0",
            proxy=url, timeout=10.0)
        return (True, f"OK HTTP {resp.status_code}") if resp.status_code == 200 else (False, f"HTTP {resp.status_code}")
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


# ── Logging ────────────────────────────────────────────────────────────────

def _add_log(level: str, msg: str):
    global _scan_logs
    ts = time.strftime("%H:%M:%S")
    _scan_logs.append({"ts": ts, "level": level, "msg": msg})
    if len(_scan_logs) > 500:
        _scan_logs = _scan_logs[-400:]
    (logger.error if level == "error" else logger.warning if level == "warn" else logger.info)(msg)

def _clear_logs():
    global _scan_logs
    _scan_logs = []

def get_scan_logs() -> list[dict]:
    return list(_scan_logs)


# ── Cache persistence ──────────────────────────────────────────────────────

def _save_cache():
    """Persist cache to disk so it survives restarts."""
    global _cache
    try:
        data = {
            "data": _cache["data"],
            "fetched_at": _cache["fetched_at"],
            "saved_at": time.time(),
            "version": "1",
        }
        _CACHE_FILE.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
    except Exception as e:
        logger.warning(f"Failed to save Zabbix cache: {e}")


def _load_cache():
    """Load persisted cache from disk on startup."""
    global _cache
    try:
        if _CACHE_FILE.exists():
            data = json.loads(_CACHE_FILE.read_text(encoding="utf-8"))
            _cache["data"] = data.get("data")
            _cache["fetched_at"] = data.get("fetched_at", 0)
            total = sum(len(v) for v in (_cache["data"] or {}).values())
            logger.info(f"Zabbix cache loaded from disk: {total} templates, age={time.time() - _cache['fetched_at']:.0f}s")
    except Exception as e:
        logger.warning(f"Failed to load Zabbix cache: {e}")
        _cache = {"data": None, "fetched_at": 0}

# Load persisted cache on module import — auto-scan if empty
_load_cache()
if _cache["data"] is None:
    import asyncio as _aio
    try:
        _aio.ensure_future(start_refresh())
    except Exception:
        pass


# ── HTTP ───────────────────────────────────────────────────────────────────

def _make_client(timeout: float = 30.0) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=timeout, proxy=_proxy_url, trust_env=False) if _proxy_url \
        else httpx.AsyncClient(timeout=timeout, trust_env=False)


async def _fetch_all_root() -> list[str]:
    """Fetch ALL root-level items using pagination.

    The root API returns FLAT paths like "app/acronis/template.yaml"
    Paginated at 25 items per page, uses nextPageStart for cursor.
    """
    base_url = (f"{ZABBIX_BASE}/rest/api/1.0/projects/{ZABBIX_PROJECT}"
                f"/repos/{ZABBIX_REPO}/files/templates"
                f"?at={ZABBIX_BRANCH.replace('/', '%2F')}")

    all_items = []
    start_param = None
    page = 0

    async with _make_client(timeout=60.0) as client:
        while page < 50:  # safety limit: 50 pages * 25 = 1250 items max
            page += 1
            url = base_url
            if start_param:
                url += f"&start={start_param}"

            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()

            page_items = data.get("values", [])
            if not isinstance(page_items, list) or not page_items:
                break

            all_items.extend(str(x) for x in page_items)

            is_last = data.get("isLastPage", True)
            if is_last is True or is_last == "true":
                break

            # Use nextPageStart cursor for next page
            nps = data.get("nextPageStart")
            if nps is not None:
                start_param = str(nps)
            else:
                break  # no cursor = no more pages

    _add_log("info", f"Root pagination: {len(all_items)} items across {page} pages")
    return all_items


# ── Progress ───────────────────────────────────────────────────────────────

def _update_progress(folder: str, status: str, files: int = 0):
    if _scan_progress is not None:
        _scan_progress["current_folder"] = folder
        _scan_progress["current_status"] = status
        if status == "done":
            _scan_progress["folders_done"] += 1
        elif status == "failed":
            _scan_progress.setdefault("folder_errors", []).append({"folder": folder, "error": str(files)})
        _scan_progress["files_found"] += max(files, 0)


# ── Main scan ──────────────────────────────────────────────────────────────

async def _build_file_tree() -> dict[str, list[dict]]:
    """Build template tree by paginating through the root API.

    Strategy: paginate root → filter .yaml → extract top-level folder → group.
    This replaces recursive subdirectory scanning entirely.
    """
    global _scan_progress

    _clear_logs()
    _add_log("info", f"代理: {_proxy_url or '直连'} | 目标: {ZABBIX_BASE}")
    if _proxy_url:
        ok, msg = _test_proxy(_proxy_url)
        _add_log("info" if ok else "error", f"代理测试: {msg}")

    # Phase 1: Fetch ALL items from root (paginated)
    _scan_progress["current_status"] = "Fetching root listing (paginated)..."
    _scan_progress["folders_total"] = 1
    _scan_progress["folders_done"] = 0
    _scan_progress["files_found"] = 0
    _add_log("info", "正在分页获取根目录完整列表...")

    try:
        all_items = await _fetch_all_root()
    except Exception as e:
        _add_log("error", f"根目录获取失败: {type(e).__name__}: {e}")
        return {}

    _scan_progress["folders_done"] = 1

    # Phase 2: Classify items
    templates = [x for x in all_items if _is_yaml(x)]
    junk = [x for x in all_items if _is_junk_file(x) and not _is_yaml(x)]
    other = [x for x in all_items if not _is_yaml(x) and not _is_junk_file(x)]

    _add_log("info", f"总计 {len(all_items)} 项: YAML={len(templates)}, 其他文件={len(junk)}, 未知={len(other)}")

    # Phase 3: Group YAML templates by top-level folder
    tree: dict[str, list[dict]] = {}
    for path in sorted(templates):
        # Path like "app/acronis/template_app_acronis.yaml"
        parts = path.split("/", 2)
        if len(parts) >= 3:
            top = parts[0]
            tree.setdefault(top, []).append({"name": parts[-1], "path": path})
        elif len(parts) == 2:
            # e.g., "root_folder/template.yaml"
            top = parts[0]
            tree.setdefault(top, []).append({"name": parts[1], "path": path})
        elif len(parts) == 1:
            # Bare YAML at root (unlikely)
            tree.setdefault("_root", []).append({"name": parts[0], "path": path})

    _scan_progress["folders_total"] = len(tree)
    _scan_progress["folders_done"] = len(tree)
    _scan_progress["files_found"] = len(templates)

    total = len(templates)
    folders = sorted(tree.keys())
    _add_log("info", f"=== 扫描完成: {total} 个模板, {len(tree)} 个目录: {folders} ===")
    for f in sorted(tree):
        _add_log("info", f"  {f}/: {len(tree[f])} templates")
    _scan_progress["current_status"] = f"Done: {total} templates in {len(tree)} folders"

    return tree


# ── Background refresh ─────────────────────────────────────────────────────

async def _do_refresh():
    global _cache, _scan_progress
    try:
        _scan_progress = {"scanning": True, "folders_total": 0, "folders_done": 0,
                          "files_found": 0, "current_folder": "", "current_status": "Starting...",
                          "started_at": time.time(), "error": None}
        _cache["data"] = await _build_file_tree()
        _cache["fetched_at"] = time.time()
        _save_cache()
        logger.info(f"Zabbix cache saved to {_CACHE_FILE}")
        _scan_progress["scanning"] = False
    except Exception as e:
        logger.error(f"Refresh failed: {e}")
        _add_log("error", f"刷新失败: {e}")
        _scan_progress["scanning"] = False
        _scan_progress["error"] = str(e)


async def start_refresh():
    global _scan_progress
    if _scan_progress and _scan_progress.get("scanning"):
        return {"status": "already_scanning"}
    _scan_progress = {"scanning": True, "folders_total": 0, "folders_done": 0,
                      "files_found": 0, "current_folder": "", "current_status": "Starting...",
                      "started_at": time.time(), "error": None}
    asyncio.create_task(_do_refresh())
    return {"status": "started"}


def get_scan_progress() -> dict:
    if _scan_progress is None:
        return {"scanning": False}
    return dict(_scan_progress)


async def get_template_list(force_refresh: bool = False) -> dict[str, list[dict]]:
    """Return cached file tree. Only refreshes when force_refresh=True."""
    global _cache
    if force_refresh:
        await start_refresh()
        return _cache["data"] if _cache["data"] else {}
    return _cache["data"] if _cache["data"] else {}


async def fetch_template_yaml(path: str) -> str:
    url = (f"{ZABBIX_BASE}/projects/{ZABBIX_PROJECT}/repos/{ZABBIX_REPO}"
           f"/raw/templates/{path}?at={ZABBIX_BRANCH.replace('/', '%2F')}")
    async with _make_client() as c:
        resp = await c.get(url)
        resp.raise_for_status()
        return resp.text


def get_cache_info() -> dict:
    now = time.time()
    age = now - _cache["fetched_at"] if _cache["fetched_at"] else None
    total = sum(len(v) for v in _cache["data"].values()) if _cache["data"] else 0
    return {"cached": _cache["data"] is not None, "cache_age_seconds": round(age) if age else None,
            "cache_ttl_seconds": CACHE_TTL, "total_files": total,
            "folders": list(_cache["data"].keys()) if _cache["data"] else []}
