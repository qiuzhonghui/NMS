"""WebSocketManager 回归测试。

重点覆盖一个**曾导致生产级死锁**的缺陷:``broadcast`` / ``broadcast_to_subscribers``
在持有 ``self._lock`` 时调用 ``disconnect``,而 ``disconnect`` 要再次获取同一把
**不可重入**的 ``asyncio.Lock`` —— 一旦有客户端发送失败,锁永不释放,
此后所有实时更新与新连接全部挂起。
"""
import asyncio

from app.websocket.manager import WebSocketManager


class _FakeWS:
    """最小 WebSocket 桩。"""

    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.sent: list[str] = []
        self.accepted = False

    async def accept(self) -> None:
        self.accepted = True

    async def send_text(self, message: str) -> None:
        if self.fail:
            raise RuntimeError("socket already closed")
        self.sent.append(message)


def test_broadcast_does_not_deadlock_on_dead_client():
    """存在发送失败的客户端时,broadcast 必须能返回(不得死锁)。"""
    manager = WebSocketManager()
    good = _FakeWS()
    dead = _FakeWS(fail=True)

    async def scenario():
        await manager.connect(good)
        await manager.connect(dead)
        # 死锁时这里会超时
        await asyncio.wait_for(manager.broadcast("metric_update", {"v": 1}), timeout=2)
        return manager.active_connections

    active = asyncio.run(scenario())

    assert len(good.sent) == 1
    assert '"event": "metric_update"' in good.sent[0]
    assert active == 1, "失败的连接应被移除"


def test_broadcast_to_subscribers_does_not_deadlock():
    """按订阅广播同样不得死锁,且只发给订阅者。"""
    manager = WebSocketManager()
    sub = _FakeWS()
    other = _FakeWS()
    dead_sub = _FakeWS(fail=True)

    async def scenario():
        for ws in (sub, other, dead_sub):
            await manager.connect(ws)
        await manager.subscribe(sub, "dev-1")
        await manager.subscribe(dead_sub, "dev-1")
        await asyncio.wait_for(
            manager.broadcast_to_subscribers("dev-1", "metric_update", {"v": 2}),
            timeout=2,
        )
        return manager.active_connections

    active = asyncio.run(scenario())

    assert len(sub.sent) == 1
    assert other.sent == [], "未订阅的客户端不应收到消息"
    assert active == 2, "失败的订阅连接应被移除"


def test_lock_is_released_after_failures():
    """失败的发送之后,管理器仍能正常工作(锁没有被永久占住)。"""
    manager = WebSocketManager()
    dead = _FakeWS(fail=True)
    later = _FakeWS()

    async def scenario():
        await manager.connect(dead)
        await asyncio.wait_for(manager.broadcast("a", {}), timeout=2)

        # 死锁修复前,这里会卡在 connect 的 lock 上
        await asyncio.wait_for(manager.connect(later), timeout=2)
        await asyncio.wait_for(manager.subscribe(later, "dev-9"), timeout=2)
        await asyncio.wait_for(manager.broadcast("b", {}), timeout=2)
        return manager.active_connections

    active = asyncio.run(scenario())

    assert len(later.sent) == 1
    assert active == 1


def test_disconnect_is_idempotent():
    """重复 disconnect 不应报错。"""
    manager = WebSocketManager()
    ws = _FakeWS()

    async def scenario():
        await manager.connect(ws)
        await manager.disconnect(ws)
        await manager.disconnect(ws)
        return manager.active_connections

    assert asyncio.run(scenario()) == 0
