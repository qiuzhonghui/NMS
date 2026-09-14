"""模块注册表 —— 隔离加载 API 模块与后台服务。

核心目标:**单个模块导入失败或启动失败,不应导致整个应用崩溃。**

- :class:`ModuleRegistry`  逐个导入并挂载 APIRouter;失败的模块被记录并跳过。
- :class:`ServiceRegistry` 逐个启动/停止后台服务;单个服务失败不影响其他服务。

两类注册表都会生成一份 :class:`BootReport`,可通过 ``/api/system/modules``
查看哪些模块正常、哪些失败及失败原因 —— 让「隔离」这件事可观测、可验证。
"""
from __future__ import annotations

import importlib
import traceback
from dataclasses import dataclass, field
from typing import Any, Protocol

from fastapi import FastAPI
from loguru import logger


class _HasRouter(Protocol):
    router: Any


@dataclass(frozen=True)
class ModuleSpec:
    """一个待挂载的 API 模块。

    Attributes:
        name: 逻辑名(日志与健康检查用),通常等于路由域,如 ``devices``。
        module: 模块导入路径,如 ``app.routers.devices``。
        attr: 模块内 APIRouter 的属性名,如 ``router`` / ``template_router``。
        prefix: 挂载前缀,默认 ``/api``(保持与既有 API 路径一致)。
    """

    name: str
    module: str
    attr: str = "router"
    prefix: str = "/api"


@dataclass(frozen=True)
class ServiceSpec:
    """一个后台服务(启动/停止函数按名解析 —— 避免启动前就导入模块)。"""

    name: str
    module: str
    start: str
    stop: str


@dataclass
class BootReport:
    """启动结果报告。"""

    modules_loaded: list[str] = field(default_factory=list)
    modules_failed: dict[str, str] = field(default_factory=dict)
    services_started: list[str] = field(default_factory=list)
    services_failed: dict[str, str] = field(default_factory=dict)
    services_stopped: list[str] = field(default_factory=list)
    # 非模块类的启动错误(例如数据库初始化失败)
    startup_errors: dict[str, str] = field(default_factory=dict)

    @property
    def healthy(self) -> bool:
        return not (self.modules_failed or self.services_failed or self.startup_errors)

    def as_dict(self) -> dict[str, Any]:
        return {
            "healthy": self.healthy,
            "modules": {
                "loaded": self.modules_loaded,
                "failed": self.modules_failed,
            },
            "services": {
                "started": self.services_started,
                "failed": self.services_failed,
                "stopped": self.services_stopped,
            },
            "startup_errors": self.startup_errors,
        }


def _short_err(exc: BaseException) -> str:
    """取简洁错误信息(保留异常类型,便于定位)。"""
    return f"{type(exc).__name__}: {exc}"


class ModuleRegistry:
    """按 spec 列表逐个导入并挂载 APIRouter,单个失败不影响其余。

    **注册顺序即路由匹配顺序**,因此 ``specs`` 的顺序必须与迁移前保持一致,
    否则可能改变路径匹配结果(破坏 API 兼容性)。
    """

    def __init__(self, specs: list[ModuleSpec], report: BootReport | None = None) -> None:
        self._specs = list(specs)
        self.report = report if report is not None else BootReport()

    def mount_all(self, app: FastAPI) -> BootReport:
        for spec in self._specs:
            self._mount_one(app, spec)
        if self.report.modules_failed:
            logger.warning(
                f"{len(self.report.modules_failed)} 个模块加载失败(应用继续运行): "
                f"{', '.join(self.report.modules_failed)}"
            )
        logger.info(f"API 模块已挂载:{len(self.report.modules_loaded)} 个")
        return self.report

    def _mount_one(self, app: FastAPI, spec: ModuleSpec) -> None:
        try:
            mod = importlib.import_module(spec.module)
            router = getattr(mod, spec.attr)
            app.include_router(router, prefix=spec.prefix)
        except Exception as exc:  # 隔离:记录并跳过,不向上抛
            self.report.modules_failed[spec.name] = _short_err(exc)
            logger.error(
                f"模块 '{spec.name}' 加载失败,已跳过(其余模块不受影响)\n"
                f"{traceback.format_exc()}"
            )
            return
        self.report.modules_loaded.append(spec.name)


class ServiceRegistry:
    """按 spec 列表启动/停止后台服务,单个失败不影响其余。

    启动函数在**调用时才导入**,因此某个服务模块自身的导入错误
    (例如依赖缺失) 也只会让该服务不可用,不阻塞其它服务启动。
    """

    def __init__(self, specs: list[ServiceSpec], report: BootReport | None = None) -> None:
        self._specs = list(specs)
        self.report = report if report is not None else BootReport()
        self._running: list[ServiceSpec] = []

    async def start_all(self) -> BootReport:
        for spec in self._specs:
            await self._start_one(spec)
        if self.report.services_failed:
            logger.warning(
                f"{len(self.report.services_failed)} 个后台服务启动失败(应用继续运行): "
                f"{', '.join(self.report.services_failed)}"
            )
        logger.info(f"后台服务已启动:{len(self.report.services_started)} 个")
        return self.report

    async def stop_all(self) -> BootReport:
        # 逆序停止,并用 try/except 兜住每个 stop —— 一个停不掉不影响其余
        for spec in reversed(self._running):
            try:
                await self._resolve(spec, spec.stop)()
            except Exception as exc:
                logger.error(f"服务 '{spec.name}' 停止失败: {_short_err(exc)}")
                continue
            self.report.services_stopped.append(spec.name)
        self._running.clear()
        return self.report

    async def _start_one(self, spec: ServiceSpec) -> None:
        try:
            await self._resolve(spec, spec.start)()
        except Exception as exc:  # 隔离:单个服务启动失败不影响启动流程
            self.report.services_failed[spec.name] = _short_err(exc)
            logger.error(
                f"后台服务 '{spec.name}' 启动失败,已跳过(其余服务不受影响)\n"
                f"{traceback.format_exc()}"
            )
            return
        self._running.append(spec)
        self.report.services_started.append(spec.name)

    @staticmethod
    def _resolve(spec: ServiceSpec, func_name: str) -> Any:
        mod = importlib.import_module(spec.module)
        return getattr(mod, func_name)
