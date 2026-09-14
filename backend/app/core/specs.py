"""应用挂载清单 —— 声明「这个应用由哪些模块与服务组成」。

新增一个功能域时,只需要在这里加一行 —— 不需要改 ``main.py``。

.. warning::
   ``MODULE_SPECS`` 的**顺序即路由匹配顺序**。调整顺序可能改变路径匹配结果
   (例如两个 router 都定义了相似路径),非必要不要重排。
"""
from __future__ import annotations

from .registry import ModuleSpec, ServiceSpec

# ── API 模块(顺序 = 路由注册顺序,须与迁移前一致以保持 API 兼容)────────────
MODULE_SPECS: list[ModuleSpec] = [
    ModuleSpec(name="discovery", module="app.routers.discovery"),
    ModuleSpec(name="devices", module="app.routers.devices"),
    ModuleSpec(name="metrics", module="app.routers.metrics"),
    ModuleSpec(name="topology", module="app.routers.topology"),
    ModuleSpec(name="racks", module="app.routers.racks"),
    ModuleSpec(name="front_panels", module="app.routers.front_panels"),
    ModuleSpec(name="alerts", module="app.routers.alerts"),
    ModuleSpec(name="device_models", module="app.routers.device_models"),
    ModuleSpec(
        name="device_models.templates",
        module="app.routers.device_models",
        attr="template_router",
    ),
    ModuleSpec(name="dashboards", module="app.routers.dashboards"),
    ModuleSpec(name="snmp_templates", module="app.routers.snmp_templates"),
    ModuleSpec(name="mib_manager", module="app.routers.mib_manager"),
    ModuleSpec(name="ai_settings", module="app.routers.ai_settings"),
    ModuleSpec(name="zabbix_templates", module="app.routers.zabbix_templates"),
]

# ── 后台服务(顺序 = 启动顺序;停止时逆序)────────────────────────────────
SERVICE_SPECS: list[ServiceSpec] = [
    ServiceSpec(
        name="snmp_collector",
        module="app.services.snmp_collector",
        start="start_collector",
        stop="stop_collector",
    ),
    ServiceSpec(
        name="icmp_monitor",
        module="app.services.icmp_monitor",
        start="start_monitor",
        stop="stop_monitor",
    ),
    ServiceSpec(
        name="alert_engine",
        module="app.services.alert_engine",
        start="start_alert_engine",
        stop="stop_alert_engine",
    ),
    ServiceSpec(
        name="retention",
        module="app.services.retention",
        start="start_retention",
        stop="stop_retention",
    ),
]
