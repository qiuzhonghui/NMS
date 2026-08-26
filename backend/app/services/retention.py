"""数据保留策略 —— 定期清理超过保留期的指标数据。

``METRICS_RETENTION_DAYS`` 此前从未被消费,导致 device_metrics /
interface_metrics / device_protocol_data 无界增长。本服务每天清理一次,
分批删除(每批 LIMIT 1000)以避免长时间持有表锁。
"""
import asyncio
from datetime import datetime, timedelta

from loguru import logger
from sqlalchemy import text

from ..config import settings
from ..database import async_session_factory

_running = False
# 每批删除行数;减少时降低锁持有时长,但清理变慢
_BATCH = 1000
_RETENTION_LOOP_INTERVAL = 86400  # 秒 = 1 天

# (表名, 时间列名)
_RETENTION_TABLES = [
    ("device_metrics", "collected_at"),
    ("interface_metrics", "collected_at"),
    ("device_protocol_data", "collected_at"),
]


async def start_retention() -> None:
    """Start the retention cleanup background service."""
    global _running
    _running = True
    asyncio.create_task(_retention_loop())
    logger.info("Retention cleanup started")


async def stop_retention() -> None:
    """Stop the retention cleanup service."""
    global _running
    _running = False
    logger.info("Retention cleanup stopped")


async def _retention_loop() -> None:
    while _running:
        try:
            await clean_expired()
        except Exception as e:
            logger.error(f"Retention cleanup error: {e}")
        await asyncio.sleep(_RETENTION_LOOP_INTERVAL)


async def clean_expired(days: int | None = None) -> dict[str, int]:
    """Delete metrics older than the retention window. Returns rows deleted per table.

    Args:
        days: retention period in days (defaults to settings.METRICS_RETENTION_DAYS).
    """
    days = days or settings.METRICS_RETENTION_DAYS
    cutoff = datetime.utcnow() - timedelta(days=days)
    cutoff_str = cutoff.strftime("%Y-%m-%d %H:%M:%S")

    deleted: dict[str, int] = {}
    async with async_session_factory() as session:
        for table, col in _RETENTION_TABLES:
            table_deleted = 0
            while True:
                result = await session.execute(
                    text(f"DELETE FROM {table} WHERE {col} < :cutoff LIMIT {_BATCH}"),
                    {"cutoff": cutoff_str},
                )
                n = result.rowcount
                table_deleted += n
                if n < _BATCH:
                    break
                await asyncio.sleep(0.05)  # 让出连接,避免长事务
            deleted[table] = table_deleted
        await session.commit()
    return deleted
