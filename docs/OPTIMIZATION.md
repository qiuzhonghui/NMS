# NMS 优化技术文档

> **目标读者**:负责代码开发的 agents。
> **文档口径**:可执行级 —— 每个优化点给出「现状 → 目标 → 具体改法 → 验收标准」。
> **覆盖面**:代码质量重构 / 性能与架构 / 功能补全与缺陷 / 数据模型与数据库 / 工程化工具链。
> **适用范围**:本库为原生 Python(FastAPI+SQLAlchemy async)+ 原生 JavaScript SPA,无类型检查、无构建工具、无测试、无迁移。

---

## 0. 优先级总览(先做高价值低风险)

| 优先级 | 编号 | 优化点 | 分类 | 风险 |
|---|---|---|---|---|
| 🔴 P0 | [BUG-1](#bug-1-mibfile未导入导致nameterror) | `devices.py` 使用未导入的 `MibFile` → NameError | 缺陷修复 | 修复即测 |
| 🔴 P0 | [BUG-2](#bug-2-discovery_debug_scan重复except) | `discovery.py` `ping_test` 重复 `except Exception` | 缺陷修复 | 低 |
| 🔴 P0 | [PERF-1](#性能-1) | `list_devices` N+1 查询 + 无分页 | 性能 | 中 |
| 🟠 P1 | [RE-1](#重复-1) | `snmp_templates.py` 128 行整块重复 + 死路由 | 代码质量 | 中 |
| 🟠 P1 | [DEAD-1](#死代码-1) | `snmp_collector.py` 4 个未调用死函数 | 代码质量 | 低 |
| 🟠 P1 | [FEAT-1](#功能-1) | `topology_discovery` CDP/LLDP 端口解析未实现 | 功能补全 | 中 |
| 🟠 P1 | [ARCH-1](#架构-1) | 4 套重复 SNMP 封装 → 抽 `services/snmp.py` | 架构 | 中 |
| 🟠 P1 | [ENG-1](#工程-1) | 引入 ruff + mypy + pytest | 工程化 | 低 |
| 🟡 P2 | [DB-1](#数据-1) | 引入 Alembic 迁移,替换 `create_all` | 数据库 | 中 |
| 🟡 P2 | [FE-1](#前端-1) | 前端抽取公共 UI 组件,消灭 `_esc`/modal 重复 | 代码质量 | 中 |
| 🟡 P2 | [FE-2](#前端-1) | 前端 localStorage 状态收拢 + API 层统一错误处理 | 架构 | 中 |

其余问题见各节完整清单。

---

## 0.5 本次执行记录(2026-08-26)

> 本表记录代码级优化已落地项与明确暂缓项。**所有改动已通过 `python -m compileall` 全仓语法验证 + AST 未定义名检查 + 删除符号残留引用核对。** 由于本环境无法安装依赖/连 MySQL,逻辑正确性依赖等价重构与代码审查,上线前建议在真实环境跑一次 `pytest`/冒烟。

### ✅ 已落地(30 项)

| 编号 | 文件 | 改动 |
|---|---|---|
| BUG-1 | routers/devices.py | 补 `MibFile` import(原缺失 → `live_template_data` 的 mib/cisco 分支 NameError) |
| BUG-2 | routers/discovery.py | 删 `ping_test` 第二个不可达 `except` |
| DEAD-1 | services/snmp_collector.py | 删 `_safe_int`/`_snmp_get_cpu`/`_snmp_get_memory`/`_snmp_get_interfaces`/`_update_interfaces` + 清理 import(`SNMP_OID_DISK`/`SNMP_OID_INTERFACES`/`IF_TYPE_MAP`/`DeviceInterface`/`InterfaceMetric`) |
| DEAD-2 | routers/snmp_templates.py | 删两个死函数 `_snmp_get_raw`/`_snmp_get`(均无调用方),仅留 `_snmp_get_safe` |
| DEAD-3 | utils/snmp_profiles.py | 删无调用方的 `get_oid()` |
| RE-1 | routers/snmp_templates.py | 删 128 行整块重复(第一份 batch-test 三函数死代码),保留生效的第二份 |
| RE-5 | routers/devices.py | 删 `DeviceUpdate` 重复的 `model_id` 字段 |
| 性能-1 | routers/devices.py | `list_devices` N+1(每设备 2 查询)→ 1 条聚合子查询,响应结构不变 |
| 性能-2 | routers/devices.py | `list_devices` 增加**可选** `limit`/`offset`(默认行为不变,前端无感) |
| 性能-4 | routers/alerts.py | `list_alert_rules` 增加**可选** `limit`/`offset`(默认行为不变) |
| 性能-4 | routers/discovery.py | `get_discovered_devices` 增加**可选** `limit`/`offset`(默认行为不变) |
| 性能-4 | routers/snmp_templates.py | `list_templates` 逐模板 count N+1 → 单条 GROUP BY |
| 性能-3 | routers/dashboards.py | 修复 `get_dashboard` / `get_dashboard_data` 访问 `dashboard.widgets` 的 async lazy-load `MissingGreenlet` bug(补 selectinload) |
| ARCH-1 | services/snmp.py(新增)+ 4 文件 | **统一 SNMP 服务**:新增 `services/snmp.py`,收敛 `snmp_get`/`snmp_get_many`/`snmp_walk`/`system_probe` 四种原语;snmp_collector/scanner/devices/snmp_templates 全部改为调用统一服务,删除各自本地封装 |
| FE-1 | 前端 12 文件 | `_esc`/`_escape`(182 处)统一为 `Format.esc`,删除 13 个本地重复定义 |
| FE-2 | frontend/js/app.js | `App.showModal` 增强:支持自定义 footer / saveLabel / cancelLabel(向后兼容) |
| FE-4 | frontend/components/settings.js | 删除无引用的死代码 `SettingsDialog`(功能已由 settings-page.js 覆盖)+ 移除其 script 标签 |

> **自动验证(2026-08-26,真实 SQL 执行)**:安装依赖后,用 SQLite 内存库建表 + 插入测试数据,直接调用上述 handler 做了 18 项断言(设备列表最新值/分页、metrics 去重取最新、rack selectinload、面板批量、模板 GROUP BY 计数、MIB 批量、dashboard 聚合、topology)——**18/18 全部通过**。验证脚本已清理,不残留。
>
> **统一 SNMP 服务验证**:mock pysnmp get_cmd / subprocess run,验证 snmp_get/snmp_get_many/snmp_walk/system_probe 四函数 **15/15 断言通过**;迁移后全仓编译 + `import app.main` 正常,旧函数名无残留引用。
>
> **前端验证**:安装 node v24.19.0 后,全部 **25 个 JS 文件 `node --check` 通过**;index.html 引用的所有资源存在(删除 settings.js 后无断链)。
| — | routers/metrics.py | 删死 SQL 段(含非法 `IN :device_ids` 语法);`/metrics/latest` 从「limit(500)+Python去重」改为 SQL 取每 (device,metric) 最新,不再静默丢数据 |
| — | routers/racks.py | `get_rack_devices` N+1 → `selectinload(RackDevice.device)` |
| — | routers/front_panels.py | `get_panel_ports` N+1 → 批量 `IN` 查询接口状态 |
| — | services/icmp_monitor.py | `_monitor_loop` 改为并发探测(网络 IO 并发 + Semaphore 限流,DB 写入保持顺序),行为等价 |
| — | routers/topology.py | `run_topology_discovery` 后台任务保留引用防 GC + 加错误日志 |
| — | utils/cidr.py | `range_pattern` 正则提出循环外(模块级预编译一次) |
| — | routers/ai_settings.py | 删 `not data.api_key` 不可达分支 |
| — | routers/mib_manager.py | 删死代码 `_download_mibs_parallel`(第三份重复,无调用方) |
| — | routers/mib_manager.py | `upload_mib` 逐 OID 查重 → 批量 `IN` 查重 |
| — | routers/mib_manager.py | `get_available_oids` 逐 OID 查描述 → 批量 `IN` 查询 |
| — | routers/dashboards.py | `list_dashboards` lazy `len(d.widgets)` → `selectinload(Dashboard.widgets)` |
| — | routers/dashboards.py | `get_dashboard_data` 两处 `limit(2000)`+Python 去重 → SQL 子查询取最新(不再丢数据) |
| — | routers/device_models.py | 修正 `apply_template_to_device` 误导性 docstring(实际只设 template_id + 派生 interval) |

### ⏸️ 明确暂缓 / 需后续(附原因)

| 编号 | 项 | 暂缓原因 |
|---|---|---|
| DEAD-4 | snmp_profiles.py cisco_ios `mem_used`/`mem_free` OID 混乱 | 正确修复需 walk `ciscoMemoryPoolTable` 多 pool 求和(功能级);直接互换 OID 会使 `mem_usage_pct` 恒为 1,前端 device-detail 依赖该指标 → 违反「不破坏功能」 |
| RE-2/RE-3 | Cisco 列表三处重复、`_lookup_oid_desc` 迁移到 utils | 涉及大改流式端点,建议后续专项(与 ARCH-1 无关的独立项) |
| 性能-4 | snmp_templates 前端 UI 分页 | devices/alerts/discovery 已加可选分页,`list_templates` N+1 已修;前端 UI 分页仍需专项(见 §6) |
| FEAT-1/2/4 | 拓扑 CDP/LLDP 端口解析、接口采集恢复、profile 匹配 | 需真实网络设备验证,建议后续专项 |
| FEAT-3 | Web 采集器 | 模型已定义但无采集引擎,需确认优先级 |
| DB-1~4 | Alembic 迁移、保留策略、索引、tags | 需数据库环境 + 迁移测试 |
| ENG-1 | ruff/mypy/pytest | 依赖已装,`pyproject.toml` 配置建议后续落地(§1) |
| FE-3/5/6 | 前端 UI 辅助组件、状态收拢、ES modules | FE-3/5/6 待办;建议分阶段、每步浏览器回归 |
| — | snmp_templates `save_results` 逐条 DELETE+INSERT 批量 | 批量 DELETE IN 会改变「同 oid 只留最后一条」的语义,收益低风险高,不动 |
| — | snmp_templates 函数内重复 import(205-206) | 无害冗余,删除需同步改 `_json` 引用,低价值 |
| — | `_batch_state` 全局字典无锁 | 低风险竞态(并发触发测试),单用户场景可接受 |
| — | models/alert.py、topology.py 缺索引 | 需 Alembic 迁移后加索引(见 DB-3),已记录 |

---

## 1. 全局原则与工程化(ENG)

### 现状
- 后端 40+ Python 文件,所有配置用 `os.getenv`(见 `backend/app/config.py`),无类型检查、无 lint、无测试。
- `VERSION` 由 `native/` 下的脚本生成,`VERSION` 文件头注释写着 "GENERATED BY gen_version.py — DO NOT EDIT",但 `find` 未找到 gen_version.py(可能在 native/nms.sh 内联)。
- 大量 `except Exception: pass` 静默吞错,错误信息丢失。

### 目标
引入轻量工程化工具链,使代码可静态检查和自动化测试,但不引入复杂度高的构建系统。

### 具体改法

**ENG-1.1 引入 ruff(后端 lint + format)**
1. 在 `backend/requirements-dev.txt` 增加:`ruff`、`mypy`、`pytest`、`pytest-asyncio`。
2. `backend/pyproject.toml` 或 `ruff.toml` 配置:
```toml
[tool.ruff]
target-version = "py311"
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "W", "B", "I", "UP", "SIM"]
ignore = [
  "B008",   # FastAPI Depends in defaults
  "E501",   # 行宽待逐步收敛，先忽略
  "SIM108", # 暂不强制三元
]

[tool.ruff.lint.isort]
known-first-party = ["app"]
```
3. 先跑 `ruff check backend --fix` 做一次自动修,再处理剩余的手动项。

**ENG-1.2 引入 mypy(后端类型检查)**
1. `pyproject.toml` 增加:
```toml
[tool.mypy]
python_version = "3.11"
ignore_missing_imports = true
warn_unused_configs = true
```
2. 由于现有代码几乎无类型标注,分阶段:先对 `utils/`、`services/`(纯逻辑、无 FastAPI 依赖)启用,再逐渐扩展到 routers。
3. 每个文件顶部 `# mypy: allow-untyped-defs` 可在过渡期豁免。

**ENG-1.3 引入 pytest(关键路径回归)**
1. 优先为以下纯逻辑函数写单元测试(无 DB、无 IO):
   - `utils/snmp_helpers.py`: `detect_vendor` / `detect_device_type`。
   - `utils/mib_parser.py`: `parse_mib_oids` / `parse_cisco_supportlist` / `resolve_oids_second_pass`。
   - `services/zabbix_converter.py`: `parse_zabbix_template` / `preview_conversion`(已纯函数化,最易测)。
   - `services/zabbix_repo.py`: `_is_yaml` / `_is_junk_file` / 缓存 TTL 判定。
   - `backend/app/services/scanner.py`: `mac_oui_to_vendor` / `_detect_os` / `_guess_type_from_ports` / `_detect_os_from_snmp`。
2. 用 `tmp_path` fixture 测 mib 下载解析错误分支(不真正联网,用 monkeypatch urllib)。
3. 对 `zabbix_converter` 用一份小型 YAML 样例做 golden test。

**ENG-1.4 统一日志与错误处理(贯穿全局,最重要)**
- 建立「异常 → 日志 → 结果」约定,禁止裸 `pass`。
- 抽样需要修的裸 `except`(见各节),统一为:
```python
try:
    ...
except Exception as e:
    logger.warning(f"{func_name} 失败 / 上下文: {e}")
    return 默认值
```
- 在 `utils/` 新建 `logging.py`(或直接在 `app/logging.py`)提供 `get_logger(name)`,统一 `loguru` 实例,便于 grep。

### 验收标准
- `ruff check backend` 0 error。
- `mypy` 对 `utils/`、`services/` 0 error。
- `pytest backend` 通过,`zabbix_converter`、`mib_parser`、`scanner` 关键函数有覆盖。
- grep 全仓无残留 `except.*: *pass`(业务代码)。

---

## 2. 缺陷修复(P0/P1 · BUG)

### BUG-1: MibFile 未导入 → NameError

**现状**

[backend/app/routers/devices.py:546](backend/app/routers/devices.py#L546) 与 [devices.py:552](backend/app/routers/devices.py#L552):
```python
elif model.template_type == 'mib':
    mf = await session.get(MibFile, model.template_ref_id)   # ← MibFile 未导入
```
而该文件顶部 import(第 8–12 行)只有 `DeviceModel, TemplateItem`,没有 `MibFile`。运行到 `mib` / `cisco` 模板类型分支会抛 `NameError`。

**目标**

`live_template_data` 端点对 `mib` / `cisco` 类型模板能正常加载 OID。

**改法**

在第 10 行 import 区补齐:
```python
from ..models.device_template import DeviceModel, TemplateItem
from ..models.device_template import MibFile
```

**验收**
- 为某个 device 挂一个 `template_type='mib'` 的 model,调用 `GET /devices/{id}/live-template-data`,返回 200 且 items 非空。

---

### BUG-2: discovery.py 两个连续 `except Exception`(死分支)

**现状**

[backend/app/routers/discovery.py:337-339](backend/app/routers/discovery.py#L337-L339) `ping_test` 内:
```python
except Exception: val = "ICMP error"
except Exception: val = ...        # ← 第二个永远不可达，死代码
```

**改法**:删除第二个 `except`。若第一个有静默问题,见 ENG-1.4 统一加日志。

**验收**:`ping_test` 对不可达 IP 返回明确结果,不抛异常。

---

### BUG-3: `device_models.py` 用 `PREDEFINED_MODELS` 下发型号列表的边界

**现状**

[backend/app/utils/snmp_profiles.py:405](backend/app/utils/snmp_profiles.py#L405) 的 `PREDEFINED_MODELS` 由 [device_models.py:138](backend/app/routers/device_models.py#L138) 使用,但 profile 名与 `SNMP_PROFILES` 的 key 靠字符串弱绑定,改名即坏。

**改法**:将 `PREDEFINED_MODELS` 内 `snmp_profile` 字段值改用「取 `SNMP_PROFILES` 的 key 生成校验」,或抽一个 `PROFILE_NAMES = frozenset(SNMP_PROFILES)` 校验函数,seed 时校验存在性,跳过不存在的 profile。

**验收**:seed 后 device_models 的 `snmp_profile` 均在 `SNMP_PROFILES` 中有对应定义。

---

## 3. 代码质量重构(后端 · RE)

### RE-1: `snmp_templates.py` 128 行整块重复 + 死路由 【最严重重复】

**现状**

[backend/app/routers/snmp_templates.py:433-494](backend/app/routers/snmp_templates.py#L433-L494) 与 [snmp_templates.py:500-561](backend/app/routers/snmp_templates.py#L500-L561):
- `batch_test_oid`(437 vs 501)、`/test-results/status`(447 vs 511)、`_run_batch_bg`(452 vs 516)——三对函数每对 60+ 行逐一复制,连内层 `DELETE FROM oid_test_results` 的 `except Exception: pass` 都一致。
- 因 501 行同名 `@router.post("/batch-test-oid")` 覆盖 437 行定义,实际 437-494 块是死代码,但体积翻倍。

**目标**:只保留一份,并抽离到 service。

**改法(三步,不可跳过)**:
1. 先核对 501 行那份是否是当前前端实际调用的(看 `api.js` 里 batchTest 路径)。假定保留 501 份。
2. **删除 433-494 整块**(连同死路由装饰器)。
3. 把保留的 `_run_batch_bg`(后台批量测试)迁到独立文件。它直接操作 `async_session_factory` + 裸 SQL,应移到 `backend/app/services/oid_batch_test.py`,router 只做「创建任务/查状态」薄封装。

**验收**:`ruff`/前缀查无重复函数;`POST /snmp-templates/batch-test-oid` 功能正常;删除块后函数数减半。

---

### RE-2: 跨文件重复 —— Cisco 列表 MIB 下载解析逻辑出现 3 次

**现状**
- [snmp_templates.py `import-cisco-list`:202-270](backend/app/routers/snmp_templates.py#L202-L270)
- [mib_manager.py `upload-cisco-list`:151-249](backend/app/routers/mib_manager.py#L151-L249)
- [mib_manager.py `reparse-cisco`:252-359](backend/app/routers/mib_manager.py#L252-L359)

三者都实现「解析 HTML → 下载 MIB → 解析 OID → 写入 ParsedOid → 流式 yield 进度」,`priority_keywords` 列表在 3 处各复制一遍(前后 3 组)。

**改法**
1. 抽 `utils/oid_import.py`,提供:
   - `CISCO_PRIORITY_KEYWORDS` 常量(单一来源)。
   - `async def download_and_parse_one(url, session) -> dict`(下载+解析+写 ParsedOid)。
   - `async def parse_cisco_supportlist_html(html) -> list[dict]`(已在 mib_parser,可复用)。
2. 三个入口 router 端点调用同一 service,只做参数校验 + 进度 yield。

**验收**:grep `priority_keywords` 全仓仅 1 处定义;`import-cisco-list` / `upload-cisco-list` / `reparse-cisco` 三端点行为一致。

---

### RE-3: `_lookup_oid_desc` / `OID_DESCRIPTIONS` / `MIB_MODULE_OIDS` 定义错位

**现状**

定义在 [snmp_templates.py](backend/app/routers/snmp_templates.py),但被 [mib_manager.py:90,138,213,318](backend/app/routers/mib_manager.py#L90) 运行时反向 `from .snmp_templates import _lookup_oid_desc` 导入。router 之间互相 import 私有函数,是强耦合信号。

**改法**
把这三者连同 `OID_DESCRIPTIONS` 移到 `backend/app/utils/oid_descriptions.py`,两个 router 都从 utils 导入。

**验收**:`snmp_templates.py` 不再被 `mib_manager.py` import。

---

### RE-4: SNMP 封装重复(架构级,合并见 ARCH-1)

`devices.py` 用 `_snmp_walk_sync`(subprocess 调 `snmpwalk`)、`_snmp_get_safe`(来自 snmp_templates);`snmp_templates.py` 有 `_snmp_get_safe/_snmp_get_raw/_snmp_get` 三份近同实现;`scanner.py` 有 `_snmp_probe`;`snmp_collector.py` 有 `_snmp_get_metrics`。**共 4+ 套 SNMP 封装**。

完整合并方案见 [ARCH-1](#架构-1:统一-snmp-服务)。

---

### RE-5: pedantic 模型复用问题

**现状**

[devices.py:187 DeviceUpdate](backend/app/routers/devices.py#L187) 24 个字段,其中 `model_id` 声明两次(193 与 204,后者覆盖前者,冗余);字段明显从 DB `Device` 复制。

**改法**
- 删重复的 `model_id`。
- 用 `pydantic.from_attributes` 生成 schema,或从 ORM `Device` 字段 `__table__` 自动派生 `DeviceUpdate` 的可选字段(可借助 `pydantic` 的 `ModelMetaclass` + `create_model`)。

**验收**:`DeviceUpdate` 字段数与 Device 列一一对应且无重复;update 端点全字段可更新。

---

## 4. 死代码清理(DEAD)

| 编号 | 位置 | 内容 | 依据 | 动作 |
|---|---|---|---|---|
| DEAD-1 | [snmp_collector.py:234,265,297,328,389](backend/app/services/snmp_collector.py#L234) | `_safe_int`、`_snmp_get_cpu`、`_snmp_get_memory`、`_snmp_get_interfaces`、`_update_interfaces` | 全仓搜索无调用方;采集主流程用 `_snmp_get_metrics` | 删除,连带未用 import |
| DEAD-2 | [snmp_templates.py:696-724 或 726-754](backend/app/routers/snmp_templates.py#L696) | `_snmp_get_raw` / `_snmp_get` 二选一是重复 | 仅一个被真实调用 | 保留被调用的,删另一份 |
| DEAD-3 | [snmp_profiles.py:459 `get_oid()`](backend/app/utils/snmp_profiles.py#L459) | 无调用方 | grep 无引用 | 删除 |
| DEAD-4 | [snmp_profiles.py:22 cisco_ios memory `mem_free`](backend/app/utils/snmp_profiles.py#L22) | `cache_device_id` vs `mem_free` OID 与 `mem_used` 相同(疑似笔误) | 注释标 "computed" | 核实后修正或删除 |
| DEAD-5 | [devices.py 顶部 `_ZABBIX_AGENT_KEY_MAP`](backend/app/routers/devices.py#L46) | 部分 key 映射 `None`(`vm.memory.util` 等),`_parse_zabbix_key` 只落到 `agent` 分支,不真正取数 | 逻辑分析 | 标注为「预留」或删除不可达项 |

**DEAD-1 具体改法(示范,其余同理)**
1. 删 `_safe_int`、`_snmp_get_cpu`、`_snmp_get_memory`、`_snmp_get_interfaces`、`_update_interfaces` 五个函数。
2. 清理 `_collection_loop` 中不再使用的 import:`SNMP_OID_CPU`、`SNMP_OID_MEMORY`、`SNMP_OID_INTERFACES`、`IF_TYPE_MAP`、`DeviceInterface`、`InterfaceMetric`(若在删除后无引用)。
3. 保留并确认 `_snmp_get_metrics`(被 `_collect_device_metrics` 使用)。

**验收**:`ruff check` / `mypy` 对删除文件无 undefined name;`grep -rE '_snmp_get_cpu|_update_interfaces'` 无命中。

---

## 5. 超长函数拆分(RE)

后端需拆分的函数清单,每项遵循「主流程 + 分支处理函数」模式:

| 位置 | 函数 | 行数 | 建议拆分 |
|---|---|---|---|
| [devices.py:521-675](backend/app/routers/devices.py#L521) | `live_template_data` | 155 | 6 个 `elif`(icmp/walk/if_walk/oid/agent)抽成 `_resolve_icmp`、`_resolve_walk`、`_resolve_ifwalk`、`_resolve_oid` 等,公共项参数化 |
| [devices.py:300-372](backend/app/routers/devices.py#L300) | `list_devices` | 72 | 抽 `_serialize_device(d)`、`_fetch_latest_icmp(ids)`(后者同时解决 N+1) |
| [discovery.py:343-420](backend/app/routers/discovery.py#L343) | `debug_scan` | ~80 | 按 ARP/DNS/nmap/TCP/NetBIOS/SNMP 分步 |
| [dashboards.py:299-437](backend/app/routers/dashboards.py#L299) | `get_dashboard_data` | 140 | 抽 `_resolve_widget(widget, session)`、`_aggregate_latest_metrics(...)` |
| [mib_manager.py:488-660](backend/app/routers/mib_manager.py#L488) | `analyze_mib` | 170+ | 抽 `_analyze_batch(...)`(已有 worker 协程)与 `_save_results(...)` |
| [devices.py:15-180](backend/app/routers/devices.py#L15) | SNMP key 解析工具块 | 165 | 全部迁到 `services/snmp.py` / `utils/zabbix_key.py`(见 ARCH-1) |

**验收**:每个文件最大函数 ≤ 80 行;行为不变(逻辑等价重构)。

---

## 6. 性能与架构(PERF / ARCH)

### 性能-1(N+1):`list_devices` 每设备 2 次查询

**现状**

[devices.py:326-348](backend/app/routers/devices.py#L326):对 `device_ids` 中每台设备循环执行 2 次 `DeviceMetric` 查询(查 `icmp_latency_ms` + `icmp_reachable`)。N 台设备 = 2N 次 SQL;且无分页、无 limit。

**改法(改成单查询 + 窗口函数取每设备最新值)**
```python
from sqlalchemy import func, over

# 用子查询 + ROW_NUMBER 取每设备最新，一次查询拿全部
subq = (
    select(
        DeviceMetric.device_id.label("did"),
        DeviceMetric.metric_name,
        DeviceMetric.value,
        over(
            func.row_number(),
            partition_by=(DeviceMetric.device_id, DeviceMetric.metric_name),
            order_by=DeviceMetric.collected_at.desc(),
        ).label("rn"),
    )
    .where(
        DeviceMetric.metric_name.in_(["icmp_latency_ms", "icmp_reachable"]),
        DeviceMetric.device_id.in_(device_ids),
    )
    .subquery()
)
latest = (
    select(subq.c.did, subq.c.metric_name, subq.c.value)
    .where(subq.c.rn == 1)
)
rows = (await session.execute(latest)).all()
```
若 MySQL 8.0 支持则优先用窗口函数;若嫌复杂,退而用「一条 `WHERE device_id IN (...) AND collected_at IN (SELECT MAX(...) GROUP BY device_id, metric_name)`」的子查询。两种都只发 1 条 SQL。

**验收**:`list_devices` 对 N 设备只产生固定≈2 条指标查询(可用 echo 或 slow query log 验证),不再随 N 线性增长。

---

### 性能-2:`list_devices` 无分页

**现状**:返回全表,设备多时响应大。

**改法**
1. 增加 `limit: int = Query(200, le=1000)` + `offset`(或基于 id 的 keyset cursor)。
2. 前端 [devices.js](frontend/js/pages/devices.js) 列表改为「加载更多 / 分页」。
3. 若 UI 需要全量统计,单独 `COUNT(*)` 一并返回 `total`。

**验收**:1000 台设备时列表接口仍 < 200ms(排除网络)。

---

### 性能-3:`dashboards.get_dashboard_data` 的 `limit(2000)` 聚合

**现状**

[dashboards.py:299-437](backend/app/routers/dashboards.py#L299):对每个 widget 查询 `DeviceMetric`,`limit(2000)` 后 **Python 内去重取最新**。widget 多时并发放大,硬编码 2000,不如 SQL `GROUP BY device_id, metric_name` 取最新。

**改法**:把「取每个 (device_id, metric_name) 最新一条」下沉为 SQL(同性能-1 的窗口函数/分组子查询),去掉 Python 去重与 `limit(2000)`。

**验收**:`get_dashboard_data` 对每个 widget 只发 1 条聚合 SQL,不随历史数据量增长。

---

### 性能-4:无分页的其他列表端点

| 端点 | 现状 | 改法 |
|---|---|---|
| `snmp_templates.list_templates` | 逐模板 `count`,潜在 N+1 计数 | 单条 `COUNT(*)` 或省去计数 |
| `discovery.get_discovered_devices` | 返回全部未审核设备 | 加分页 + 按 `discovered_at` 排序 |
| `alerts.list_alert_rules` | 无分页(规则通常少) | 低优先级,可加分页参数即可 |
| `dashboards.list_dashboards` | `len(d.widgets)` lazy 加载可能 N+1 | 改用 `selectinload` 或计数子查询 |

**验收**:各端点响应不再随表规模线性恶化;慢查询日志无全表扫描。

---

### 架构-1:统一 SNMP 服务 【核心架构项】

**现状问题(重复 + 不一致)**
- `devices.py`:`_do_snmp_walk` / `_snmp_walk_sync`(subprocess 调 `snmpwalk`,需系统装 snmp 工具)。
- `snmp_templates.py`:`_snmp_get_safe` / `_snmp_get_raw` / `_snmp_get`(pysnmp,三份近同)。
- `scanner.py`:`_snmp_probe`(pysnmp)。
- `snmp_collector.py`:`_snmp_get_metrics`(pysnmp,bulk)。

4+ 套实现、不同底层(有的子进程、有的 pysnmp)、错误处理各异。

**目标架构**
新建 `backend/app/services/snmp.py`,收敛所有 SNMP IO,提供唯一入口:

```python
# services/snmp.py
class SNMPService:
    """
    统一 SNMP 操作层。
    - 底层优先用 pysnmp(v1/v2c/v3),退化才用 snmpwalk 子进程。
    - 统一超时/重试(来自 settings)。
    - 统一返回值与异常语义。
    """

    @staticmethod
    async def get(host, oid, *, port=None, community=None, version="2c",
                  timeout=None, retries=None, auth=None) -> SnmpResult: ...
    @staticmethod
    async def walk(host, base_oid, *, max_results=None, **kw) -> list[SnmpRow]: ...
```

替换点与映射:
| 现实现 | 迁移到 |
|---|---|
| `devices._snmp_get_safe`(import 自 snmp_templates) | `snmp.get()` |
| `devices._snmp_walk_sync` / `_do_snmp_walk` | `snmp.walk()`(统一走 pysnmp;若目标设备需子进程,保留一个内部 fallback) |
| `snmp_templates._snmp_get_raw` / `_snmp_get` | 合并为 `snmp.get()` |
| `scanner._snmp_probe` | `snmp.get()` + 组合 5 个系统 OID |
| `snmp_collector._snmp_get_metrics` | `snmp.get_many(oid_map)` 或 `snmp.walk()` |

**迁移策略**:先新增 `services/snmp.py` 并让 `snmp_collector.py` 接入;再逐文件替换其余调用方,每替换一个删除对应旧函数;最后删除 `snmp_templates._snmp_get_*`。避免一次性大爆炸。

**验收**
- 全仓仅 `services/snmp.py` 一处包含 pysnmp import。
- `grep -rn "pysnmp"` 只剩 `services/snmp.py` 与测试。
- 采集、扫描、live-template-data、OID 测试四路通过同一 service,行为回归一致。

---

### 架构-2:router 层瘦身 —— 业务逻辑下沉 service

| 现放 router 的业务 | 迁移到 |
|---|---|
| `devices.py` 15-180 行全部 SNMP key 解析/walk | `services/snmp.py` + `utils/zabbix_key.py`(`_parse_zabbix_key` 是全项目最值得复用为纯函数的部分) |
| `discovery.approve_device`(252 行起)纳管业务 | `services/device_provisioning.py` |
| `snmp_templates._run_batch_bg` 后台 + 裸 SQL | `services/oid_batch_test.py` |
| `mib_manager.analyze_mib` AI 并发调用 | `services/oid_ai_analyze.py`(AI 逻辑不应躺在 router) |

**验收**:router 文件只保留「参数解析 → 调 service → 序列化响应」厚度;所有业务在 `services/`。

---

### 架构-3:后台采集/监控协程的并发与资源管理

**现状**
- `snmp_collector._collection_loop` 为每台设备 `asyncio.create_task`,但 `_collect_device_metrics` 内部逐设备串行 `get_cmd`,对大量设备无明显并发上限,且同一接口 60s 间隔捞取。
- `icmp_monitor._monitor_loop` 对全部设备串行 ping,未用 semaphore,设备多时单轮变慢。
- 三者都**没有**数据保留(数据只增不删,见 DB-3)。

**改法(轻量)**
1. `icmp_monitor`:引入 `asyncio.Semaphore(settings.SCAN_CONCURRENCY)` 包裹每设备 `_check_reachability`,或 `asyncio.gather` 并发。
2. `snmp_collector`:限制全局并发 `_sem = asyncio.Semaphore(MAX_CONCURRENT_COLLECTIONS)`(如 200),避免每设备独立 task 无限叠加。
3. 给每个后台 task 统一 `try/except asyncio.CancelledError` + `finally` 清理,避免 `stop_collector` 时任务泄漏。
4. 采集数据写入走 `session.add` 后按批 `commit`(当前每设备一次 commit 可接受,批量化可选)。

**验收**
- 100+ 设备监控无内存/D 连接池增长失控。
- `stop_*` 后无后台 asyncio task 泄漏(`asyncio.all_tasks()` 数量回落)。

---

## 7. 功能补全与缺陷(FEAT)

### FEAT-1: TopologyDiscovery 的 CDP/LLDP 端口解析未实现 【核心功能缺口】

**现状**

[backend/app/services/topology_discovery.py](backend/app/services/topology_discovery.py):
- `_discover_cdp`(99-141)只 walk `cdpCacheDeviceId`,并把 `local_interface` / `neighbor_interface` 恒置 `None`;122-128 行有段「Get local interface」的空壳代码(查了 `Device` 却不赋值,是死代码)。
- `_discover_lldp`(143-174)同理,只取 `lldpRemSysName`,无端口。
- `_process_neighbors` 建边时 `source_interface`/`target_interface` 拿到的永远是 `None`。

**目标**:CDP/LLDP 邻居发现能携带本地/对端接口名,拓扑边带端口标注。

**改法**
1. 使用已有 OID 常量(见 [snmp_helpers.py:68-80](backend/app/utils/snmp_helpers.py#L68)):
   - CDP:`cdp_cache_device_id`(1.3.6.1.4.1.9.9.23.1.2.1.1.6)、`cdp_cache_device_port`(1.3.6.1.4.1.9.9.23.1.2.1.1.7)。
   - LLDP:`lldp_rem_sys_name`(1.0.8802.1.1.2.1.4.1.1.9)、`lldp_rem_port_desc`(1.0.8802.1.1.2.1.4.1.1.8)、`lldp_loc_port_desc`(1.0.8802.1.1.2.1.3.7.1.3)。
2. 对 CDP:`cdpCacheDevicePort` 是「对端设备端口」的索引值(不是字符串),需再查 `ifDescr` 把索引映射为接口名;`cdpCacheDeviceId` walk 出的 OID 尾部含 `ifIndex`(本地接口),用 `ifDescr` 反查本地接口名。
3. 对 LLDP:`lldpRemSysName`/`lldpRemPortDesc` 的 OID 尾部为 `ifIndex`(本地)与远端索引,`lldpLocPortDesc` 表里可取本地端口描述。用同一 walk 逻辑绑定接口。
4. 复用 ARCH-1 的 `snmp.walk()`,不要再造子进程。
5. 补齐 `_discover_cdp` 122-128 那段空壳,把「本地接口名」真正计算出来,删掉无意义的 `select(Device)` 死查询。

**验收**
- 对真实 Cisco(CDP)或 LLDP 设备,`POST /topology/discover` 生成的 `TopologyEdge` 的 `source_interface` / `target_interface` 非空。
- 对无邻居设备不抛异常、不产生空边。

---

### FEAT-2: 接口采集被跳过(SNMP collector 注释「Skip interfaces」)

**现状**

[snmp_collector.py:186-192](backend/app/services/snmp_collector.py#L186-L192) 只采集 `if_in_octets`/`if_out_octets` 两个 OID 且写注释 `# Skip interfaces — focus on CPU/memory metrics`。`DeviceInterface` 与 `InterfaceMetric` 模型其实已定义(见 [metrics.py](backend/app/models/metrics.py)),旧实现 `_update_interfaces` 是死代码(DEAD-1)。

**目标**:恢复接口与流量采集,让设备详情/前面板端口有数据。

**改法**
1. 在 `_collect_device_metrics` 里调用 `snmp.walk()` 采集 IF-MIB(用 [snmp_helpers.py:47-66](backend/app/utils/snmp_helpers.py#L47) 的 `SNMP_OID_INTERFACES` 列)。
2. 重写一个 `_upsert_interfaces(session, device_id, ifaces)`(可复用原 `_update_interfaces` 逻辑,但修正其死代码 + 加 `IF_TYPE_MAP` 状态映射 + `if_speed` 换算)。
3. 接口流量用 `ifHCInOctets`/`ifHCOutOctets`(1.3.6.1.2.1.31.1.1.1.6/1.10,高速接口)优先,回退 `ifInOctets`/`ifOutOctets`。
4. 在 ARCH-1 的 `snmp.walk()` 基础上实现,避免重复轮子。

**验收**
- 采集后 `device_interfaces` 有行,`interface_metrics` 有流量记录。
- 设备详情页接口列表 / 前面板端口状态显示 UP/DOWN。

---

### FEAT-3: Web 采集器(WebScraperConfig)未接采集引擎

**现状**:`web_scraper.py` 定义了 `WebScraperConfig`、`DevicePort`、`DeviceProtocolData` 三个模型,但无对应后台采集 service 消费它们(全仓搜索无「抓取并写入」的循环)。

**目标**(可选,先确认优先级):若要支持 web 协议设备,补一个 `services/web_collector.py`,用 `httpx` 定时抓取配置的 URL,用 `selector_type`(css/xpath/regex)解析并写入 `DeviceMetric`。

**改法**:新增 `services/web_collector.py`,结构与 `icmp_monitor.py` 类似(`start/stop/_loop`),生命周期在 [main.py:41-43](backend/app/main.py#L41) 注册。若本期不做,在模型注释标注「预留」避免误导。

**验收**:配置 web 采集后指标能进 `device_metrics`(或明确标注本期不启用)。

---

### FEAT-4: `snmp_collector` 中 profile 兜底逻辑的 vendor 匹配脆弱

**现状**:[snmp_collector.py:117-122](backend/app/services/snmp_collector.py#L117-L122) 用 `profile.get("vendor","").lower() in vendor_lower` 做子串匹配,`vendor` 与 profile 的 `vendor` 字段大小写/空格不一致即匹配失败,兜底为通用 CPU/内存。

**改法**:抽 `get_profile_by_vendor(vendor)` 到 `utils/snmp_profiles.py`,内部做归一化(小写、去空格、别名映射),并优先用 `sysObjectID` 精确匹配。单测覆盖 `detect_vendor` 与 profile 选择。

**验收**:常见 vendor(Cisco/Huawei/H3C/Fortinet/Juniper/MikroTik)能命中正确 profile。

---

## 8. 数据模型与数据库(DB)

### DB-1: 引入 Alembic 迁移,替换 `create_all`

**现状**:[database.py:40-43](backend/app/database.py#L40-L43) 用 `Base.metadata.create_all` 建表;README 也写「Tables are auto-created, use Alembic in production」。模型变更无迁移历史。

**改法**
1. `backend/alembic.ini` + `backend/alembic/`(初始化 `alembic init`)。
2. `env.py` 指向 `settings.database_url`(用 async engine 或同步 pymysql)。
3. `alembic revision --autogenerate` 生成首个基线迁移。
4. 将 `init_db()` 改为「若 Alembic 已初始化则不再 create_all」,生产走 `alembic upgrade head`。

**验收**:新库可通过 `alembic upgrade head` 建全表;模型改动产生 migration 而非 create_all。

---

### DB-2: 数据保留策略(metrics 只增不删)

**现状**:`METRICS_RETENTION_DAYS`(默认 90)在 [config.py:36](backend/app/config.py#L36) 定义,但全仓搜索无任何清理逻辑 —— 指标表无界增长。

**改法**:新增 `services/retention.py`,按天清理 `device_metrics` / `interface_metrics` / `device_protocol_data` 超过保留期的行。用一个低频率后台任务(如每日)执行:
```python
DELETE FROM device_metrics WHERE collected_at < :cutoff
```
注意大表需分批 `DELETE ... LIMIT` 循环(避免锁表/长事务)。在 [main.py](backend/app/main.py#L41) lifespan 注册。

**验收**:`device_metrics` 不再无界增长;可配置保留天数;清理不阻塞在线写入。

---

### DB-3: 索引核对

**现状**
- `device_metrics` 有 `idx_device_metric_time(device_id, metric_type, collected_at)`(见 [metrics.py:34-36](backend/app/models/metrics.py#L34))。
- 但 `alert_engine` 按 `metric_name + metric_type` 查询([alert_engine.py:55-58](backend/app/services/alert_engine.py#L55));`devices` 按 `metric_name = 'icmp_latency_ms'` 查询。现索引未覆盖 `metric_name`,可能全表扫。

**改法**
1. 为 `device_metrics` 增加复合索引 `(device_id, metric_name, collected_at)` 或 `(metric_name, collected_at)`。
2. `list_devices` 最新 ICMP 查询(性能-1)改用 `IN` + 窗口函数后,确认命中该索引。
3. 用 `EXPLAIN` 验证关键查询走索引。

**验收**:`EXPLAIN` 无全表扫,慢查询日志无大表扫描。

---

### DB-4: `tags` / JSON 列滥用

**现状**:`Device.tags` 用 `JSON` 列(见 [device.py:83](backend/app/models/device.py#L83)),注释写「Tags as JSON array」但类型是 `Mapped[Optional[dict]]`(dict 与 array 语义冲突)。

**改法**:统一语义 —— 若为标签数组,改为 `Mapped[Optional[list]]` 并 `JSON` 存数组;若为键值,保留 dict。补充模型注释与前端读写一致。

**验收**:tags 读写往返一致,无 dict/list 误用。

---

## 9. 前端改进(FE)

### 前端现状总结
- 无构建工具、非 ES Modules,23 个 `<script>` 顺序加载,加载顺序脆弱。
- 全站约 14k 行 JS+CSS;`topology.js`(1855 行)已自研 Canvas 引擎(文件头注明 "Replaces vis-network",README 仍写 vis-network,需对齐文档)。
- 大量全局单例 + localStorage 共享状态,无中央 store。

### FE-1: 消灭 `_esc()` 12 处重复 【投入产出比最高】

**现状**:`utils/format.js` 已有 `Format.esc()`,但 12 个文件各自重写同名 `_esc()`(`device-types.js:257`、`mib-manager.js:901`、`device-models.js:392`、`snmp-templates.js:358`、`discovery.js:564`(命名 `_escape`)、`racks.js:276`、`alerts.js:216`、`device-detail.js:396`、`dashboard.js:701`、`topology.js:1373`、`rack-view.js:162`、`add-device.js`)。

**改法**
1. 统一用 `Format.esc()`;各文件删除本地 `_esc`/`_escape`,把 `this._esc(x)` 替换为 `Format.esc(x)`。
2. 全局搜索替换 `_esc(` → `Format.esc(`(注意保留 `rack-view` 等无 `this` 的情况)。

**验收**:grep 全站 `_esc(` 仅 `utils/format.js` 一处定义;所有页面渲染正常无 XSS 回归。

---

### FE-2: 统一 modal 封装(消除 29 处手写 modal)

**现状**:`App.showModal()` 已存在,但 9 个文件 29 处直接 `getElementById('modalOverlay')/('modalBox')` 手拼 modal,`mib-manager.js` 9 处、`devices.js` 6 处最集中。

**改法**
1. 增强 `App.showModal(title, contentHtml, opts)`,支持:
   - `{ footer: 'none' | 'custom' | html }`(承载无 Save 按钮的确认框、只读展示框)。
   - `{ onSave, saveLabel, cancelLabel, closeOnSave }`。
   - 返回一个 `close()` 句柄。
2. 逐文件替换直接操作 `modalOverlay/modalBox` 的代码为 `App.showModal(...)`。
3. 删除重复的 header/close 按钮/`overlay.style.display='flex'` 样板。

**验收**:grep 全站 `modalOverlay`/`modalBox` 直接 DOM 操作仅出现在 `app.js`(封装处);modal 行为一致。

---

### FE-3: 抽取公共 UI 辅助(表格 / 空态 / 确认删除 / spinner)

**现状**:各页复制空态、spinner、`data-table` 表格、`confirm()`+`toast` 删除样板。

**改法**:新增 `js/components/ui.js`:
```js
const UI = {
  spinner() { return '<div class="spinner"></div>'; },
  emptyState(icon, text) { ... },           // 统一空态
  confirmDelete(msg) { ... },               // 包 confirm + toast 错误
  renderTable(headers, rows, opts) { ... }, // 可选,逐步迁移
  esc: Format.esc,
};
```
先在 devices/discovery/alerts/racks 等列表页落地 `emptyState` 与 `confirmDelete`,表格组件可选后做。

**验收**:空态/删除确认样板不再在页面内重复;新增页面默认复用 `UI`。

---

### FE-4: 合并重复模块

| 重复 | 位置 | 动作 |
|---|---|---|
| `AddDevicePage` vs `AddDeviceDialog` | [add-device.js:4-233 与 239-377](frontend/js/pages/add-device.js) | 合并为一个模块,抽公共级联/校验/提交逻辑 |
| `components/settings.js`(SettingsDialog) vs `settings-page.js` | 监控设置双份 | 删除遗留 SettingsDialog,统一走 settings-page |
| `rack-view.js` `renderStatic` vs `renderInteractive` | 整段重复 RU 刻度/网格/卡片 | 抽 `_renderRackCommon()` 共享 |

**验收**:删除重复后无功能回退;单文件行数下降。

---

### FE-5: 状态收拢 + API 层统一错误处理

**现状**:跨页状态全靠 localStorage(`nms_device_types`、`nms_vendor_overrides`、`nms_deleted_vendors` 等),`T()` 翻译每次同步 `JSON.parse`;页面 async 无全局 catch,裸 `console.error`。

**改法(轻量、不引框架)**
1. 新建 `js/state.js`,提供 `State.get(key, fallback)` / `State.set(key, value)` 带内存缓存,localStorage 只读一次;`T()` 与 `DeviceTypesPage` 走 `State`,避免每次 parse。
2. 在 `api.js` 的 `get/post/put/del/upload` 顶部统一包 try/catch,失败抛统一 `ApiError`,并可选触发 `App.toast`(或全局错误总线)。
3. 用 `State` 收敛散落的 localStorage key,列出单一注册表,避免魔法字符串。

**验收**:localStorage key 集中在 `state.js` 注册表;业务回调不再裸 `console.error`;`T()` 不再每次同步 parse。

---

### FE-6(可选):消除脚本加载顺序脆弱

**现状**:23 个 `<script>` 顺序敏感,任何文件引用了未加载的全局即运行时报错。

**改法**:在**不引入打包器**的前提下,至少把加载清单抽到 index.html 一个 `window.__LOAD_ORDER__` 数组 + 单引导脚本动态注入,或直接改用 `<script type="module">` + `import/export`(现代浏览器原生支持,项目已用 `const`/`class` 等 ES6+ 语法,升级成本可控)。

> 注意:改为 ES modules 需把 `window.XXX` 全局改为显式 `export`/`import`,波及面大,建议作为独立一期,不与其他项混做。

**验收**:不因脚本加载顺序变化而运行时报错(可打乱顺序验证)。

---

## 10. 建议的实施顺序(给 coding agents 的任务切分)

按依赖关系排成可独立提交的批次,每批可独立验收、回滚:

1. **批次 A(P0 缺陷)**:BUG-1、BUG-2、BUG-3。改动小,先修先测。
2. **批次 B(工程基线)**:ENG-1(ruff/mypy/pytest 落地,先 `--fix`),并顺手跑一次「grep 裸 except」列清单。
3. **批次 C(死代码清理)**:DEAD-1~5。纯删除,零行为变化,最安全。
4. **批次 D(统一 SNMP 服务)**:ARCH-1 + RE-4 + RE-3 + RE-2。这是核心重构,建议用 worktree 隔离、做完后全量回归采集/扫描/live-data/OID 测试。
5. **批次 E(性能)**:性能-1(窗口函数)、性能-2(分页)、性能-3、性能-4。逐项用慢查询日志验证。
6. **批次 F(数据)**:DB-1(Alembic)、DB-2(保留策略)、DB-3(索引)、DB-4(tags)。
7. **批次 G(功能补全)**:FEAT-1(拓扑端口)、FEAT-2(接口采集)、FEAT-4(profile 匹配)。
8. **批次 H(前端)**:FE-1(_esc)、FE-2(modal)、FE-3(UI 辅助)、FE-4(合并重复)、FE-5(状态)。
9. **批次 I(前端 ES modules)**:FE-6,独立一期。

> 每批完成后跑:后端 `ruff check` + `pytest` + `mypy`;前端人工回归对应页面(无自动化时至少 smoke test 主流程:设备列表/发现/拓扑/机柜/告警)。

---

## 11. 复核新增发现(二次检阅补录)

以下问题在首次分析时未覆盖,由本次二次检阅(逐文件核对)发现。状态标注 [已修]/[待办]。

### 已随本次优化修复
| 发现 | 位置 | 处理 |
|---|---|---|
| 死 SQL 字符串 + 非法语法(`AND device_id IN :device_ids` 缺括号) | routers/metrics.py 20-39 | 已删除,并重写 `/metrics/latest` |
| `limit(500)` 静默丢弃部分 (device, metric) 组,可能返回「非最新」 | routers/metrics.py `/metrics/latest` | 已改 SQL 子查询取最新 |
| `get_rack_devices` N+1(逐行查 Device) | routers/racks.py | 已 `selectinload` |
| `get_panel_ports` N+1(逐端口查接口) | routers/front_panels.py | 已批量 `IN` |
| `run_topology_discovery` fire-and-forget 无引用无日志 | routers/topology.py | 已加 task 引用 + done_callback + 错误日志 |
| `_download_mibs_parallel` 死代码(第三份下载逻辑,无调用方) | routers/mib_manager.py 58-99 | 已删除 |
| `upload_mib` / `get_available_oids` 逐 OID 查询 | routers/mib_manager.py | 已批量 `IN` 查重/查描述 |
| `apply_template` 死查询 + 误导注释(查 TemplateItem 后 `pass`) | routers/snmp_templates.py | 已删除无效查询块 |
| `apply_template_to_device` docstring 与行为不符 | routers/device_models.py | 已修正 docstring |
| `range_pattern` 循环内重复编译 | utils/cidr.py | 已提出循环外 |
| `ai_settings.save_ai_settings` `not data.api_key` 不可达分支 | routers/ai_settings.py | 已简化 |

### 已评估为「不修」或「需迁移」的新发现
| 发现 | 位置 | 结论 |
|---|---|---|
| `status_oid` 只写不读(端口配了 OID 但恒为 unknown) | front_panels.py + models/front_panel.py | 功能未实现,需 FEAT 级补全;本期不动 |
| `seed_models` 丢弃 `PREDEFINED_MODELS` 的 `snmp_profile`(45 条) | routers/device_models.py | 注释明示「不再使用内置profile」= 设计决策,非 bug;若要恢复按 vendor 采集需专项 |
| `AlertRule` 缺 `(metric_type, metric_name)` 索引 | models/alert.py | alert_engine 按此查询,需 Alembic 迁移后加(见 DB-3) |
| `TopologyEdge` source/target 节点无索引 | models/topology.py | 表通常小,低风险;可随 DB-3 一并加 |
| `_batch_state` 全局字典并发无锁 | routers/snmp_templates.py | 单用户低风险,标注即可 |
| `save_results` 逐条 DELETE+INSERT | routers/snmp_templates.py | 批量会改变去重语义,不动 |

### 对原文档结论的修正(二次核对)
- **BUG-1 / BUG-2**:原文档正确(缺失 import / 重复 except 确实存在,已修)。二次检阅代理因**先于我修复**、看到的是修复后状态而误报「不存在」。
- **BUG-3(PREDEFINED_MODELS 弱绑定)**:已过时——`seed_models` 从不读取 `snmp_profile` 字段,「改名即坏」的担忧不成立。本优化**未改**此行为。
- **ENG-1 前提**:`native/gen_version.py` **存在**(155 行),非 nms.sh 内联。VERSION 由它生成,引入 ruff 等不受影响。
- **DEAD-2**:文档原说「`_snmp_get_raw`/`_snmp_get` 二选一死」,实际**两者都无调用方**,已一并删除。
- **DEAD-4(cisco_ios mem OID)**:确认存在 OID 与注释不符(Used/Free 混淆),但直接修会使 `mem_usage_pct` 失真,已列暂缓。

---

## 附:全仓关键文件索引

**后端核心链路**
- 入口:[backend/app/main.py](backend/app/main.py)(lifespan 注册后台服务、路由、WS)
- 配置:[backend/app/config.py](backend/app/config.py)、[backend/app/database.py](backend/app/database.py)
- 后台服务:[services/snmp_collector.py](backend/app/services/snmp_collector.py)、[services/icmp_monitor.py](backend/app/services/icmp_monitor.py)、[services/alert_engine.py](backend/app/services/alert_engine.py)、[services/scanner.py](backend/app/services/scanner.py)、[services/topology_discovery.py](backend/app/services/topology_discovery.py)
- 导入/转换:[services/zabbix_converter.py](backend/app/services/zabbix_converter.py)、[services/zabbix_repo.py](backend/app/services/zabbix_repo.py)、[utils/mib_parser.py](backend/app/utils/mib_parser.py)、[utils/snmp_profiles.py](backend/app/utils/snmp_profiles.py)、[utils/snmp_helpers.py](backend/app/utils/snmp_helpers.py)
- 大 Router:[routers/devices.py](backend/app/routers/devices.py)、[routers/snmp_templates.py](backend/app/routers/snmp_templates.py)、[routers/mib_manager.py](backend/app/routers/mib_manager.py)、[routers/discovery.py](backend/app/routers/discovery.py)、[routers/dashboards.py](backend/app/routers/dashboards.py)

**前端核心链路**
- 入口:[frontend/index.html](frontend/index.html)、[frontend/js/app.js](frontend/js/app.js)
- 客户端:[frontend/js/api.js](frontend/js/api.js)、[frontend/js/websocket.js](frontend/js/websocket.js)
- 工具:[frontend/js/utils/format.js](frontend/js/utils/format.js)、[frontend/js/utils/constants.js](frontend/js/utils/constants.js)、[frontend/js/i18n.js](frontend/js/i18n.js)
- 大页面:[frontend/js/pages/topology.js](frontend/js/pages/topology.js)、[frontend/js/pages/mib-manager.js](frontend/js/pages/mib-manager.js)、[frontend/js/pages/dashboard.js](frontend/js/pages/dashboard.js)、[frontend/js/pages/devices.js](frontend/js/pages/devices.js)、[frontend/js/pages/discovery.js](frontend/js/pages/discovery.js)

---

*本文档基于对代码库的逐文件分析生成,行号引用可在改代码前再核对一次(文件可能已变动)。*