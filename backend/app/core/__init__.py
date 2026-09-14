"""core —— 应用级横切基础设施。

- 模块注册与故障隔离(:mod:`app.core.registry`)
- 挂载清单(:mod:`app.core.specs`)
"""
from .registry import (
    BootReport,
    ModuleRegistry,
    ModuleSpec,
    ServiceRegistry,
    ServiceSpec,
)
from .specs import MODULE_SPECS, SERVICE_SPECS

__all__ = [
    "BootReport",
    "ModuleRegistry",
    "ModuleSpec",
    "ServiceRegistry",
    "ServiceSpec",
    "MODULE_SPECS",
    "SERVICE_SPECS",
]
