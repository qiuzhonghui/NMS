"""SNMP 采集器调度回归测试。

覆盖一个**曾导致设备只被采集一次**的缺陷:采集任务完成后未从
``_collector_tasks`` 移除,导致 ``if device.id not in _collector_tasks``
永远为假,后续轮次再也不会为该设备创建采集任务。
"""
import asyncio
import functools

from app.services import snmp_collector as sc


def test_release_task_removes_finished_task():
    """任务完成后应释放 device_id,使下一轮能重新调度。"""
    sc._collector_tasks.clear()

    async def scenario():
        async def noop() -> None:
            return None

        task = asyncio.create_task(noop())
        sc._collector_tasks["dev-1"] = task
        task.add_done_callback(functools.partial(sc._release_task, "dev-1"))

        await task
        await asyncio.sleep(0)  # 让 done_callback 执行
        return dict(sc._collector_tasks)

    assert asyncio.run(scenario()) == {}

    # 释放后,下一轮循环的条件 `device.id not in _collector_tasks` 为真 → 会重新采集
    assert "dev-1" not in sc._collector_tasks


def test_release_task_does_not_remove_newer_task():
    """旧任务的回调不应误删同一设备上更新的任务。"""
    sc._collector_tasks.clear()

    async def scenario():
        async def noop() -> None:
            return None

        older = asyncio.create_task(noop())
        newer = asyncio.create_task(noop())
        sc._collector_tasks["dev-2"] = newer

        # 模拟:older 完成时,字典里已经是 newer
        sc._release_task("dev-2", older)
        result = dict(sc._collector_tasks)

        await asyncio.gather(older, newer)
        return result

    result = asyncio.run(scenario())
    assert "dev-2" in result, "不应删除更新的任务"

    sc._collector_tasks.clear()
