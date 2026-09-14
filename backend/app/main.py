"""FastAPI application entry point for NMS."""
import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger
from sqlalchemy.orm import configure_mappers

from .config import settings
from .core import (
    MODULE_SPECS,
    SERVICE_SPECS,
    BootReport,
    ModuleRegistry,
    ServiceRegistry,
)
from .database import close_db, init_db
from .websocket import ws_manager

FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"
VERSION_FILE = Path(__file__).resolve().parent.parent.parent / "VERSION"

def get_version() -> str:
    try:
        first_line = VERSION_FILE.read_text(encoding='utf-8').split('\n')[0].strip()
        return first_line
    except Exception:
        return "1.0.0"


# 启动报告 + 后台服务注册表(模块级单例:stop 必须复用 start 的同一实例)
boot_report = BootReport()
service_registry = ServiceRegistry(SERVICE_SPECS, boot_report)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown events.

    每一步都做**故障隔离**:数据库初始化或任一后台服务失败都不会阻止应用启动。
    失败详情记入 ``boot_report``,可通过 ``GET /api/system/modules`` 查看。
    """
    logger.info("Starting NMS application...")

    # ORM mapper 预检:SQLAlchemy 的 mapper 配置是**惰性**的 —— relationship
    # 里写错类名不会在 import 时报错,而是在此后第一次(哪怕是无关表的)查询时
    # 才抛 InvalidRequestError,导致所有域一起挂且难以定位。
    # 这里显式提前配置,把这类错误变成启动期、可隔离、可上报的错误。
    try:
        configure_mappers()
        logger.info("ORM mappers configured.")
    except Exception as exc:
        boot_report.startup_errors["orm_mappers"] = f"{type(exc).__name__}: {exc}"
        logger.error(f"ORM mapper 配置失败,应用仍将启动(数据库相关接口会报错): {exc}")

    try:
        await init_db()
        logger.info("Database tables ensured.")
    except Exception as exc:
        boot_report.startup_errors["database"] = f"{type(exc).__name__}: {exc}"
        logger.error(
            f"数据库初始化失败,应用仍将启动(依赖数据库的接口会返回错误): {exc}"
        )

    await service_registry.start_all()

    yield

    logger.info("Shutting down NMS application...")
    await service_registry.stop_all()
    try:
        await close_db()
    except Exception as exc:
        logger.error(f"关闭数据库连接失败: {exc}")
    logger.info("Shutdown complete.")


app = FastAPI(
    title="NMS - Network Management System",
    description="A comprehensive network management system with auto-discovery, "
                "monitoring, topology visualization, and rack management.",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- API Modules ---
# 逐个隔离挂载:任一模块导入失败只导致该模块的接口缺失,应用照常启动。
# 挂载清单见 app/core/specs.py;顺序即路由匹配顺序。
ModuleRegistry(MODULE_SPECS, boot_report).mount_all(app)


# --- WebSocket endpoint ---
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    """Main WebSocket endpoint for real-time updates."""
    await ws_manager.connect(ws)
    try:
        while True:
            raw = await ws.receive_text()
            data = json.loads(raw)
            action = data.get("action")

            if action == "subscribe_device":
                device_id = data.get("device_id")
                if device_id:
                    await ws_manager.subscribe(ws, device_id)
                    await ws_manager.send_personal(ws, {
                        "event": "subscribed", "device_id": device_id
                    })

            elif action == "unsubscribe_device":
                device_id = data.get("device_id")
                if device_id:
                    await ws_manager.unsubscribe(ws, device_id)

            elif action == "ping":
                await ws_manager.send_personal(ws, {"event": "pong"})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WS error: {e}")
    finally:
        await ws_manager.disconnect(ws)


# --- Static file serving (SPA) ---
@app.get("/api/health")
async def health_check():
    return {"status": "ok", "version": get_version()}

@app.get("/api/version")
async def api_version():
    return {"version": get_version()}


@app.get("/api/settings")
async def get_settings():
    """Get current monitoring settings."""
    from .services import icmp_monitor
    return {
        "icmp_interval": getattr(icmp_monitor, '_check_interval', 15),
        "snmp_interval": settings.METRICS_COLLECTION_INTERVAL,
        "alert_interval": settings.ALERT_CHECK_INTERVAL,
    }


from pydantic import BaseModel


class SettingsUpdate(BaseModel):
    icmp_interval: int = 15
    snmp_interval: int = 60
    alert_interval: int = 60


@app.post("/api/settings")
async def update_settings(data: SettingsUpdate):
    """Update monitoring settings."""
    from .services.icmp_monitor import set_interval as set_icmp
    set_icmp(data.icmp_interval)
    settings.METRICS_COLLECTION_INTERVAL = data.snmp_interval
    settings.ALERT_CHECK_INTERVAL = data.alert_interval
    return {"status": "ok", "icmp_interval": data.icmp_interval}


@app.get("/api/system/modules")
async def system_modules():
    """启动健康报告:哪些模块/服务已加载、哪些失败及失败原因。

    这是「故障隔离」的可观测入口 —— 某个模块坏掉时这里会显示它失败,
    而其余模块照常工作,便于快速定位。
    """
    return boot_report.as_dict()


# Serve frontend static files if they exist
if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve the SPA for any non-API route."""
        # 1) API 路径不做 SPA 兜底。
        #    否则某个模块挂掉(未注册)时,/api/xxx 会落到这里返回 index.html
        #    (200 text/html),前端拿到 HTML 解析 JSON 失败,既掩盖了「哪个模块
        #    挂了」也难以定位。这里明确返回 404 JSON。
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail=f"API endpoint not found: /{full_path}")

        # 2) 目录穿越防护:只允许返回 FRONTEND_DIR 内的文件
        try:
            target = (FRONTEND_DIR / full_path).resolve()
            if target.is_file() and target.is_relative_to(FRONTEND_DIR.resolve()):
                return FileResponse(str(target))
        except (OSError, ValueError):
            pass

        return FileResponse(str(FRONTEND_DIR / "index.html"))
