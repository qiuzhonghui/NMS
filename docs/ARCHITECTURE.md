# NMS 现代化重构 — 架构方案与迁移计划

> 本文档由「架构设计工作流」产出:3 位独立架构师出方案 → 3 个视角的评审团打分 → 综合。
> 评审团对方案的**纠错**是本文件最有价值的部分 —— 它们推翻了若干「看起来成立、实际不成立」的隔离假设。

## 1. 目标

| 目标 | 含义 |
|---|---|
| **故障隔离** | 单个模块/服务/外部依赖故障,不再拖垮整个应用 |
| **敏捷性** | 改一个业务域,只在一个目录内完成 |
| **不破坏功能** | 所有 REST 路径、请求/响应结构、WebSocket 事件名保持不变 |

**验证手段的现实约束**:无 MySQL、无真实网络设备、无浏览器。因此所有验收必须能在
「纯 Python + Node 静态解析」下完成 —— 这也是下文大量使用
「OpenAPI 快照 diff / DDL diff / 注入式坏模块测试」的原因。

## 2. 已落地(P0 / P1 / P4 / P8 及若干评审修正)

| 项 | 内容 | 文件 |
|---|---|---|
| 模块注册表 | 逐模块隔离导入挂载,单模块失败只丢该模块路由 | `app/core/registry.py`、`app/core/specs.py` |
| 服务注册表 | 逐服务隔离启动/停止;单个服务失败不影响其余 | 同上 |
| 启动报告 | `BootReport` 记录 loaded/failed/startup_errors | 同上 |
| 可观测入口 | `GET /api/system/modules` | `app/main.py` |
| 数据库隔离 | 数据库不可用不阻止应用启动 | `app/main.py` lifespan |
| **ORM mapper 预检** | 启动时显式 `configure_mappers()` | `app/main.py` |
| **API 路径不兜底** | 未注册的 `/api/*` 返回 404 JSON 而非 200 HTML | `app/main.py` |
| **目录穿越防护** | SPA 兜底只允许返回 FRONTEND_DIR 内文件 | `app/main.py` |
| **模型解耦** | `gen_uuid` 从 `models/device.py` 抽到 `app/utils/ids.py` | 8 个模型文件 |

### 隔离效果的可执行证据(现有测试)

- `tests/test_registry.py` —— 注入不存在的模块 / 拼错属性 / 抛异常的服务,断言其余照常工作
- `tests/test_app_boot.py` —— 无 MySQL 时应用仍启动、14 模块全加载、失败被结构化上报;
  未注册 `/api/*` 返回 404 JSON;SPA 路由仍回落 index.html;目录穿越被阻断
- `tests/test_websocket_manager.py`、`tests/test_snmp_collector.py` —— 两个生产级缺陷的回归测试

## 3. 目标结构(后端垂直切片)

```
backend/app/
  main.py             # 只负责组装:注册表挂载 + lifespan + 静态资源
  core/               # 内核:零业务依赖
    registry.py       #   模块/服务注册表 + 启动报告
    specs.py          #   挂载清单(新增功能域只改这一行)
    schema.py         #   (待建)ORM 原子加载 + preflight
    lifecycle.py      #   (待建)带异常上报的 run_forever
  shared/             # 跨域无状态库:SNMP 客户端、MIB 解析、CIDR…
  modules/
    devices/          # {router.py, models.py, service.py, public.py}
    discovery/
    topology/
    racks/
    front_panels/
    alerts/
    monitoring/       # snmp_templates + mib_manager + device_models + zabbix
    dashboards/
    ai/
```

**域间调用约定**:跨域只允许经 `modules/<other>/public.py`(由 AST 边界测试强制),
禁止直接 import 对方的 `models.py` / `service.py`。

## 4. ⚠️ 评审团的关键纠错(不可忽视)

这几条推翻了「直觉上成立」的方案假设,后续施工必须按纠正后的事实来:

### 4.1 模型层做不到「完全隔离」

- `gen_uuid` 曾被 8 个模型文件导入 → device.py 坏掉则**全部**模型 metadata 失败。
  *(已修复:抽到 `utils/ids.py`)*
- 更根本的:**FK 闭包会把隔离面拉平**。9 个域里只有 `dashboards` 真正 FK 独立;
  `racks` / `topology` / `alerts` / `web_scraper` 的外键都指向 `devices.id`。
  而且存在环:`devices → front_panels → device_interfaces → devices`。
  即「front_panels 单独坏掉」会经 FK 闭包连带移除 8/9 的域。
- **结论**:模型层不要承诺「按域隔离」,只承诺「启动期可诊断 + 不静默」。
  应做的是:启动时 `configure_mappers()` 预检(已做) + 独立进程 preflight。

### 4.2 SQLAlchemy mapper 错误不是 fail-fast

实测:某域 `relationship("Typo")` 拼错时,**import 阶段不报错**(类定义成功);
此后对**完全无关的健康表**做第一次 ORM 查询才抛 `InvalidRequestError`。
默认表现是:启动成功、`/api/health` 返回 200,然后在某个随机时刻所有域的 DB 接口一起挂。

→ 必须显式 `configure_mappers()` 提前触发(已做),否则这类错误根本不在启动路径上。

### 4.3 前端「单页错误边界」在现有代码下不成立

`app.js` 的 `App.pages` 是**直接对象引用**(`topology: TopologyPage, ...`)。
若 `pages/topology.js` 加载失败 → `window.TopologyPage` 为 undefined →
`app.js` 顶层求值抛 `ReferenceError: TopologyPage is not defined` → **App 永远不被定义** →
整个 SPA 崩溃(与「单页隔离」的目标正好相反)。
另外代码里有 **130+ 处内联 `onclick="XxxPage.方法()"`**,这些只认 `window` 属性。

→ 前端 ESM 化的**前置条件**:
1. `App.pages` 改为惰性(返回 Promise/thunk),而非直接引用;
2. 建立 `window` 桥,把被内联引用的对象(`14 个 Page + App + Format + I18N + T + AddDeviceDialog + TypeManager`)镜像到 `window`;
3. 跨页单例 `TypeManager`(定义在 device-types 却被 device-models/devices 使用)与 `AddDeviceDialog` 必须先抽到共享模块,否则懒加载后为 undefined。

### 4.4 其它已采纳的纠正

- `except BaseException` 会吞掉 `CancelledError`/`KeyboardInterrupt` → 一律用 `except Exception`(现有实现已符合)。
- 服务注册表只观测「启动结果」,不观测 liveness → 游离 Task 崩溃后状态仍显示 running。
  需要 `run_forever` 包装(计划 P3)。
- 移动文件后必须同步更新 `pyproject.toml` 的 `per-file-ignores`(models 的 F821 豁免)
  与 mypy `files` 列表,否则 ruff 误报、mypy **静默失去覆盖**。

## 5. 迁移计划(P0–P13)

| 步 | 风险 | 内容 | 状态 |
|---|---|---|---|
| P0 | 低 | 收敛隔离内核(注册表 + 启动报告) | ✅ 完成 |
| P1 | 低 | 路由清单黄金快照(API 契约不变) | ✅ 完成(119→120 条,0 丢失) |
| P2 | 中 | 服务启动超时 + 循环异常上报 + 严格模式 | ⏳ 部分(隔离已做,超时/严格模式待做) |
| P3 | 中 | `run_forever` 包装 4 个后台循环 | ⏳ 待做 |
| P4 | 低 | 抽 `gen_uuid` 到中立模块 | ✅ 完成(`utils/ids.py`) |
| P5 | **高** | 模型按域就位 + `core/schema.py` 原子加载 + preflight | ⏳ 待做(见 4.1/4.2) |
| P6 | 中 | router 按域就位 + specs 切换 | ⏳ 待做 |
| P7 | 中 | service 按域就位 | ⏳ 待做 |
| P8 | 低 | SPA 兜底排除 `/api` | ✅ 完成 |
| P9 | 中 | 前端前置层:window 桥 + `App.pages` 惰性 + destroy 钩子 | ⏳ 待做(见 4.3) |
| P10 | **高** | 前端 ESM 原子切换(单入口 + 容错 dynamic import + 25 文件 export) | ⏳ 待做 |
| P11 | 中 | 前端错误边界 + BrokenPage + 后端降级 banner | ⏳ 待做 |
| P12 | 低 | 部署脚本与部分清单同步 | ⏳ 待做 |
| P13 | 低 | 兼容 shim + CI 门禁 + 文档 | ⏳ 待做 |

**每步统一验收闸门**:
`python -c "import app.main"` 成功 · OpenAPI 路径 diff 无丢失 · `Base.metadata`/DDL diff 无变化 ·
`ruff` + `mypy` + `pytest` 全绿 · 前端 `node --check`(以及 ESM 阶段的 import 图检查)

## 6. 本方案不做什么(范围边界)

-  不引入 DI 框架 / 消息队列 / 微服务进程拆分
- ❌ 不引入前端打包器(坚持原生 ES Modules)
- ❌ 不改变任何 REST 路径、请求/响应结构、WebSocket 事件名
- ❌ 不承诺「模型层完全隔离」(见 4.1,物理上做不到)
- ❌ 不在本轮做 Alembic 接管运行时建表(需 MySQL 环境验证)

## 7. 已知限制(诚实披露)

- 模型层的 FK 闭包意味着**部分域的隔离是有限的**,这是 schema 设计决定的,不是重构能消除的。
- `metadata.remove()` / `fk._colspec` 属私有或历史 API,若采用「原子加载 + 净化」方案,
  必须补「移除后遍历剩余表断言无悬空 FK」的强校验。
- 本环境无 MySQL:`create_all` 在 SQLite 上即使外键指向不存在的表也能建表成功,
  但在 MySQL/InnoDB 上会因 errno 1215 失败 —— 因此纯内存断言不足以覆盖生产风险。