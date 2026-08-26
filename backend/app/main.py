"""FastAPI application entry point for NMS."""
import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger

from .config import settings
from .database import close_db, init_db

# Import routers (lazy — added as they are built)
from .routers import (
    ai_settings,
    alerts,
    dashboards,
    device_models,
    devices,
    discovery,
    front_panels,
    metrics,
    mib_manager,
    racks,
    snmp_templates,
    topology,
    zabbix_templates,
)
from .websocket import ws_manager

FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"
VERSION_FILE = Path(__file__).resolve().parent.parent.parent / "VERSION"

def get_version() -> str:
    try:
        first_line = VERSION_FILE.read_text(encoding='utf-8').split('\n')[0].strip()
        return first_line
    except Exception:
        return "1.0.0"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown events."""
    logger.info("Starting NMS application...")
    await init_db()
    logger.info("Database tables ensured.")

    # Start background monitoring services
    from .services.alert_engine import start_alert_engine, stop_alert_engine
    from .services.icmp_monitor import start_monitor, stop_monitor
    from .services.retention import start_retention, stop_retention
    from .services.snmp_collector import start_collector, stop_collector

    await start_collector()
    await start_monitor()
    await start_alert_engine()
    await start_retention()
    logger.info("Background services started.")

    yield

    logger.info("Shutting down NMS application...")
    await stop_collector()
    await stop_monitor()
    await stop_alert_engine()
    await stop_retention()
    await close_db()
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

# --- API Routers ---
app.include_router(discovery.router, prefix="/api")
app.include_router(devices.router, prefix="/api")
app.include_router(metrics.router, prefix="/api")
app.include_router(topology.router, prefix="/api")
app.include_router(racks.router, prefix="/api")
app.include_router(front_panels.router, prefix="/api")
app.include_router(alerts.router, prefix="/api")
app.include_router(device_models.router, prefix="/api")
app.include_router(device_models.template_router, prefix="/api")
app.include_router(dashboards.router, prefix="/api")
app.include_router(snmp_templates.router, prefix="/api")
app.include_router(mib_manager.router, prefix="/api")
app.include_router(ai_settings.router, prefix="/api")
app.include_router(zabbix_templates.router, prefix="/api")


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


# Serve frontend static files if they exist
if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve the SPA for any non-API route."""
        file_path = FRONTEND_DIR / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(FRONTEND_DIR / "index.html"))
