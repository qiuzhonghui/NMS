"""故障隔离基础设施测试 —— 证明「单模块/单服务故障不拖垮整体」。

这些测试就是「隔离真的生效」的可执行证据:故意注入坏模块/坏服务,
断言其余部分照常工作。
"""
import asyncio
from unittest import mock

from fastapi import FastAPI

from app.core.registry import (
    BootReport,
    ModuleRegistry,
    ModuleSpec,
    ServiceRegistry,
    ServiceSpec,
)
from app.core.specs import MODULE_SPECS, SERVICE_SPECS

# ── 模块隔离 ────────────────────────────────────────────────────────────────


def test_broken_module_does_not_break_others():
    """一个模块导入失败 → 只记录该模块失败,其余模块照常挂载,不抛异常。"""
    app = FastAPI()
    specs = [
        ModuleSpec(name="good", module="app.routers.metrics"),
        ModuleSpec(name="broken", module="app.routers.does_not_exist_xyz"),
        ModuleSpec(name="good2", module="app.routers.racks"),
    ]

    report = ModuleRegistry(specs).mount_all(app)  # 不应抛异常

    assert report.modules_loaded == ["good", "good2"]
    assert "broken" in report.modules_failed
    assert "does_not_exist_xyz" in report.modules_failed["broken"]
    assert not report.healthy

    # 好模块的路由确实挂上了
    paths = app.openapi().get("paths", {})
    assert any(p.startswith("/api/metrics") for p in paths), paths.keys()
    assert any(p.startswith("/api/racks") for p in paths), paths.keys()


def test_missing_router_attribute_is_isolated():
    """模块能导入但没有对应属性(例如拼错 attr)→ 同样只记录失败。"""
    app = FastAPI()
    specs = [ModuleSpec(name="badattr", module="app.routers.metrics", attr="nope")]

    report = ModuleRegistry(specs).mount_all(app)

    assert report.modules_loaded == []
    assert "badattr" in report.modules_failed
    assert "AttributeError" in report.modules_failed["badattr"]


def test_all_real_module_specs_load():
    """真实清单里的模块应全部加载成功(防止清单写错)。"""
    app = FastAPI()
    report = ModuleRegistry(MODULE_SPECS).mount_all(app)

    assert report.modules_failed == {}, report.modules_failed
    assert len(report.modules_loaded) == len(MODULE_SPECS)
    assert report.healthy


def test_registry_preserves_spec_order():
    """注册顺序必须等于清单顺序(顺序即路由匹配顺序,影响 API 兼容性)。"""
    app = FastAPI()
    report = ModuleRegistry(MODULE_SPECS).mount_all(app)
    assert report.modules_loaded == [s.name for s in MODULE_SPECS]


# ── 服务隔离 ────────────────────────────────────────────────────────────────


def _stub_resolver(spec: ServiceSpec, func_name: str):
    """bad 服务抛异常,good 服务为空协程。

    签名必须与 ServiceRegistry._resolve(spec, func_name) 一致。
    """
    if spec.name == "bad":
        def _boom():
            raise RuntimeError("service exploded")
        return _boom
    async def _noop():
        return None
    return _noop


def test_broken_service_does_not_stop_others():
    """一个后台服务启动失败 → 其余服务照常启动,启动流程不中断。"""
    registry = ServiceRegistry([
        ServiceSpec(name="good1", module="m", start="s", stop="t"),
        ServiceSpec(name="bad", module="m", start="s", stop="t"),
        ServiceSpec(name="good2", module="m", start="s", stop="t"),
    ])

    with mock.patch.object(ServiceRegistry, "_resolve", staticmethod(_stub_resolver)):
        report = asyncio.run(registry.start_all())

    assert report.services_started == ["good1", "good2"]
    assert "bad" in report.services_failed
    assert "RuntimeError" in report.services_failed["bad"]


def test_stop_all_is_isolated_and_reverse_order():
    """停止一个服务失败,不影响其余服务停止;停止顺序为启动的逆序。"""
    stopped: list[str] = []

    def resolver(spec: ServiceSpec, func_name: str):
        if spec.name == "bad":
            def _boom():
                raise RuntimeError("stop failed")
            return _boom

        async def _record():
            # 只在 stop 阶段记录(start 阶段同样会调用本 resolver)
            if func_name == "t":
                stopped.append(spec.name)
        return _record

    registry = ServiceRegistry([
        ServiceSpec(name="a", module="m", start="s", stop="t"),
        ServiceSpec(name="b", module="m", start="s", stop="t"),
        ServiceSpec(name="bad", module="m", start="s", stop="t"),
    ])

    with mock.patch.object(ServiceRegistry, "_resolve", staticmethod(resolver)):
        asyncio.run(registry.start_all())
        report = asyncio.run(registry.stop_all())

    # 逆序停止:bad → b → a;bad 抛错被隔离,b、a 仍被停止
    assert stopped == ["b", "a"], stopped
    assert "bad" not in report.services_stopped


def test_stop_only_stops_started_services():
    """启动失败的服务不应被 stop(不该停一个没起来的服务)。"""
    registry = ServiceRegistry([
        ServiceSpec(name="good", module="m", start="s", stop="t"),
        ServiceSpec(name="bad", module="m", start="s", stop="t"),
    ])
    with mock.patch.object(ServiceRegistry, "_resolve", staticmethod(_stub_resolver)):
        asyncio.run(registry.start_all())
        report = asyncio.run(registry.stop_all())

    assert registry._running == []
    assert report.services_stopped == ["good"]


# ── 报告 ───────────────────────────────────────────────────────────────────


def test_boot_report_shape_and_health():
    r = BootReport()
    assert r.healthy is True
    assert r.as_dict()["healthy"] is True

    r.modules_failed["x"] = "boom"
    assert r.healthy is False

    r2 = BootReport()
    r2.startup_errors["database"] = "conn refused"
    assert r2.healthy is False
    assert r2.as_dict()["startup_errors"]["database"] == "conn refused"


def test_real_service_specs_are_importable():
    """真实服务清单里的 start/stop 函数必须存在(防止清单写错)。"""
    for spec in SERVICE_SPECS:
        start = ServiceRegistry._resolve(spec, spec.start)
        stop = ServiceRegistry._resolve(spec, spec.stop)
        assert callable(start), spec.name
        assert callable(stop), spec.name
