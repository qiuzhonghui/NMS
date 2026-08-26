"""WebSocket connection manager with pub/sub for real-time updates."""
import json
import asyncio
from typing import Any, Dict, Set

from fastapi import WebSocket
from loguru import logger


class WebSocketManager:
    """Manages WebSocket connections with subscription-based message routing."""

    def __init__(self) -> None:
        # All active connections: websocket -> set of subscribed device IDs
        self._connections: Dict[WebSocket, Set[str]] = {}
        self._lock: asyncio.Lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        """Accept and register a new WebSocket connection."""
        await ws.accept()
        async with self._lock:
            self._connections[ws] = set()
        logger.info(f"WS client connected, total: {len(self._connections)}")

    async def disconnect(self, ws: WebSocket) -> None:
        """Remove a disconnected WebSocket client."""
        async with self._lock:
            self._connections.pop(ws, None)
        logger.info(f"WS client disconnected, total: {len(self._connections)}")

    async def subscribe(self, ws: WebSocket, device_id: str) -> None:
        """Subscribe a client to a device's metric updates."""
        async with self._lock:
            if ws in self._connections:
                self._connections[ws].add(device_id)

    async def unsubscribe(self, ws: WebSocket, device_id: str) -> None:
        """Unsubscribe a client from a device's updates."""
        async with self._lock:
            if ws in self._connections:
                self._connections[ws].discard(device_id)

    async def send_personal(self, ws: WebSocket, data: Dict[str, Any]) -> None:
        """Send a message to a specific client."""
        try:
            await ws.send_text(json.dumps(data))
        except Exception as e:
            logger.error(f"WS send error: {e}")
            await self.disconnect(ws)

    async def broadcast(self, event: str, payload: Dict[str, Any]) -> None:
        """Broadcast a message to ALL connected clients."""
        message = json.dumps({"event": event, **payload})
        async with self._lock:
            dead: list[WebSocket] = []
            for ws in list(self._connections.keys()):
                try:
                    await ws.send_text(message)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                await self.disconnect(ws)

    async def broadcast_to_subscribers(
        self, device_id: str, event: str, payload: Dict[str, Any]
    ) -> None:
        """Send a message to all clients subscribed to a specific device."""
        message = json.dumps({"event": event, "device_id": device_id, **payload})
        async with self._lock:
            dead: list[WebSocket] = []
            for ws, subs in self._connections.items():
                if device_id in subs:
                    try:
                        await ws.send_text(message)
                    except Exception:
                        dead.append(ws)
            for ws in dead:
                await self.disconnect(ws)

    @property
    def active_connections(self) -> int:
        return len(self._connections)


ws_manager = WebSocketManager()
