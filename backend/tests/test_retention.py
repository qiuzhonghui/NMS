"""Retention cleanup 单元测试:mock session 验证分批删除逻辑与 SQL。

生产是 MySQL(支持 ``DELETE ... LIMIT`` 分批);SQLite 不支持该语法,故用
mock 验证控制流而非真实执行。
"""
import asyncio
from unittest import mock

from app.services import retention


class _FakeRow:
    def __init__(self, n):
        self.rowcount = n


class _FakeCtx:
    """替代 async_session_factory() 的 async context manager。"""

    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, *exc):
        return False


def test_clean_expired_batches_and_covers_all_tables():
    calls: list[tuple[str, dict]] = []

    # 每表:满批(1000)继续,不满(<1000)结束。
    # device_metrics: 1000,500 → 1500;interface_metrics: 0 → 0;device_protocol_data: 3 → 3
    counts = iter([1000, 500, 0, 3])
    session = mock.MagicMock()

    async def fake_execute(stmt, params):
        calls.append((str(stmt), dict(params)))
        return _FakeRow(next(counts))

    session.execute = fake_execute
    session.commit = mock.AsyncMock()

    with mock.patch.object(retention, "async_session_factory", return_value=_FakeCtx(session)):
        deleted = asyncio.run(retention.clean_expired(days=30))

    assert set(deleted.keys()) == {
        "device_metrics",
        "interface_metrics",
        "device_protocol_data",
    }
    assert deleted == {"device_metrics": 1500, "interface_metrics": 0, "device_protocol_data": 3}
    # 4 次 DELETE:表1两批(满批后继续)+ 表2、表3各一批
    assert len(calls) == 4, calls
    assert "LIMIT" in calls[0][0]
    assert "cutoff" in calls[0][1]
    session.commit.assert_awaited_once()


def test_clean_expired_stops_on_short_batch():
    """单批返回不满时立即结束该表,不继续下一批。"""
    calls: list[str] = []
    # 表1:1000(满批→继续),500(不满→停止) = 2 次;表2、表3 各 0 = 1 次
    counts = iter([1000, 500, 0, 0])
    session = mock.MagicMock()

    async def fake_execute(stmt, params):
        calls.append(str(stmt))
        return _FakeRow(next(counts))

    session.execute = fake_execute
    session.commit = mock.AsyncMock()

    with mock.patch.object(retention, "async_session_factory", return_value=_FakeCtx(session)):
        asyncio.run(retention.clean_expired(days=90))

    assert len(calls) == 4, calls
