# NMS 代码审计发现(53 项,已对抗性验证)

> 由审计工作流产出:7 个子系统并行审计 → 每条发现由独立 agent 读代码对抗性验证。
> 统计:原始 56 项,确认 53 项,驳回 3 项。

## 1. [高] #frontPanelSection 同一标签写了两个 style 属性,display:none 被丢弃,无前面板设备也永远显示空白卡片

- **位置**: `frontend/js/pages/device-detail.js:111`
- **类别**: correctness | **区域**: frontend-pages | **是否改变行为**: 否

**证据**: 第 111 行: `<div class="card" style="margin-top:20px;" id="frontPanelSection" style="display:none;">`。按 HTML 规范重复属性只保留第一个,第二个 `style="display:none;"` 被解析器丢弃,所以元素初始是可见的。131-134 行只在 `if (device.front_panel_id)` 时设 `style.display='block'`,对没有前面板的设备不会有任何隐藏动作,导致页面底部总有一张标题为 "Device Front Panel" 的空卡片。

**建议修法**: 把两个 style 合并为一个: frontend/js/pages/device-detail.js:111 改为 `<div class="card" id="frontPanelSection" style="margin-top:20px;display:none;">`。

**验证结论**: Line 111 has two style attributes; HTML parsing keeps the first (margin-top:20px) and discards display:none, so the element starts visible, and the only other reference (line 132) merely sets display='block' when front_panel_id exists, leaving devices without a front panel showing an empty "Device Front Panel" card — merging the two style attrs is behavior-preserving and safe.

## 2. [高] 引用不存在的 oidLoadBar 元素,打开 MIB/Cisco 详情弹窗必然抛 TypeError

- **位置**: `frontend/js/pages/mib-manager.js:486`
- **类别**: correctness | **区域**: frontend-pages | **是否改变行为**: 否

**证据**: _renderOidDetailModal 末尾三行: `document.getElementById('oidLoadBar').style.display = '';`(486)、`...('oidLoadBarFill').style.width = '100%';`(487)、`setTimeout(() => document.getElementById('oidLoadBar')...`(488)。但该函数拼出的 modal HTML(433 行)里只有 id="oidTestProgress"/"oidTestBar"/"oidTestStats",全仓库 grep `oidLoadBar` 仅命中这 3 行,没有任何创建处。getElementById 返回 null,读 `.style` 抛 TypeError。

**建议修法**: 删除 frontend/js/pages/mib-manager.js:486-488 三行(或改为 if (el) 判空)。这三行是早期加载条残留,当前 _renderOidDetailModal 已用 content-visibility:auto 一次性渲染全部行(485 行),不再需要进度条。

**验证结论**: mib-manager.js:486-488 引用的 oidLoadBar/oidLoadBarFill 在全仓库仅这三行出现、无任何创建处,弹窗 HTML(433 行)只有 oidTestProgress/oidTestBar/oidTestStats,故 getElementById 返回 null、读 .style 必抛 TypeError(经调用方 818/827 的 catch 变成一条误报 toast);这三行是死代码残留,删除不影响弹窗渲染,修法安全。

## 3. [高] broadcast/broadcast_to_subscribers 持锁调用 disconnect → asyncio.Lock 重入死锁

- **位置**: `backend/app/websocket/manager.py:62`
- **类别**: correctness | **区域**: models-utils | **是否改变行为**: 否

**证据**: manager.py:54-62 在 `async with self._lock:` 块内收集失败连接后执行 `for ws in dead: await self.disconnect(ws)`(第 61-62 行)。而 disconnect 定义在 25-29 行:`async with self._lock:` 再次获取同一把锁。asyncio.Lock 不可重入,同一 task 二次 acquire 会永久阻塞。broadcast_to_subscribers 第 69-78 行同样(77-78 行调用 disconnect)。该方法由 snmp_collector.py:179/212 每个采集周期调用、discovery.py 扫描期间高频调用。一旦某个客户端 socket 已关闭导致 send_text 抛异常(线上必然发生),整个 ws_manager 的锁永不释放:后续所有 connect/subscribe/broadcast 全部挂起,实时更新永久失效。

**建议修法**: 把 disconnect 调用移出锁范围:先 `async with self._lock:` 只做快照收集(dead 列表),退出 with 后再逐个 `await self.disconnect(ws)`;或让 disconnect 内部使用 `self._connections.pop(ws, None)` 且不取锁(仅在事件循环单线程下)。同时建议把 `await ws.send_text()` 也移出锁(broadcast 内先拷贝 dict(list, 再做发送),避免慢客户端造成全局队头阻塞。改 manager.py:54-78。

**验证者修正的修法**: Fix both methods in backend/app/websocket/manager.py. broadcast (51-62): replace lines 54-62 with `async with self._lock:\n    targets = list(self._connections.keys())\ndead: list[WebSocket] = []\nfor ws in targets:\n    try:\n        await ws.send_text(message)\n    except Exception:\n        dead.append(ws)\nfor ws in dead:\n    await self.disconnect(ws)`. broadcast_to_subscribers (69-78): replace lines 69-78 with `async with self._lock:\n    targets = [ws for ws, subs in self._connections.items() if device_id in subs]\ndead: list[WebSocket] = []\nfor ws in targets:\n    try:\n        await ws.send_text(message)\n    except Exception:\n        dead.append(ws)\nfor ws in dead:\n    await self.disconnect(ws)`. The lock is only held to snapshot the target list; sends and disconnect run outside it, so disconnect's own lock acquire (line 27) no longer deadlocks. disconnect already uses self._connections.pop(ws, None) (line 28), making the post-snapshot disconnect safe against concurrent removal.

**验证结论**: manager.py:54-62 and 69-78 call disconnect (manager.py:25-29, which re-acquires the same non-reentrant asyncio.Lock) while already holding self._lock, so any failed send_text permanently deadlocks the lock; the fix (snapshot under lock, disconnect outside) is idempotent and preserves behavior.

## 4. [高] nms.sh 内两份 DB 迁移清单已漂移，do_deploy/upgrade 走的是较小的那份

- **位置**: `native/nms.sh:942`
- **类别**: duplication | **区域**: native-deploy | **是否改变行为**: 否

**证据**: do_deploy 内联迁移块（938-952 行）与独立函数 _auto_migrate_db()（1280-1307 行）逻辑重复。对比可知 do_deploy 版本少了：`ALTER TABLE template_items ADD COLUMN metric_type/protocol/data_type`（1291-1293）、devices 的 snmp_template_id/mib_file_id/cisco_list_id/zabbix_template_id（1300-1303）、device_models 的 template_type/template_ref_id（1304-1305）。而 do_update 的 git 分支（1381-1390）只调用 do_deploy 后 return，**完全不会调用 _auto_migrate_db**；只有非 git 的 TFTP 分支（1406）才调用它。即 git 模式下升级走的是被裁剪过的清单。

**建议修法**: native/nms.sh:938-952 删除内联迁移块，改为在 do_deploy 开头统一调用 `_auto_migrate_db`（该函数已存在），消除两份清单，保证 deploy/upgrade/update 三条路径迁移一致（合入 1291-1305 的超集）。

**验证者修正的修法**: native/nms.sh: the finding's line numbers are ~7 lines stale; current locations are: inline migration block in do_deploy at lines 945-959 (not 938-952), _auto_migrate_db at 1287-1314 (not 1280-1307). Fix with current numbers: (1) delete lines 945-959 (the inline block starting at the comment "# ── Auto DB migration: add missing columns/tables" through its closing `fi`); (2) in do_deploy, after the install check at lines 827-829 and before line 831 (`SRC="${PROJECT_DIR}"`), add a single call `_auto_migrate_db`. Verified _auto_migrate_db is a strict superset: it re-creates all the same tables/columns AND adds template_items.metric_type/protocol/data_type (1298-1300), devices.snmp_template_id/mib_file_id/cisco_list_id/zabbix_template_id (1307-1310), device_models.template_type/template_ref_id (1311-1312), so no schema element is lost. _auto_migrate_db returns 0 when ${INSTALL_DIR}/.env is absent (same guard as the removed inline block, and do_deploy already dies at 827-829 if .env is missing). It is defined at 1287, before the bottom dispatcher at 1536-1549 that invokes do_deploy, so calling it from do_deploy is order-safe. This unifies deploy/upgrade/update onto the superset list without behavior loss.

**验证结论**: Confirmed in current code: do_deploy carries an inline migration block (945-959) that is a strict subset of _auto_migrate_db (1287-1314), and do_update's git path (1395-1396) never calls _auto_migrate_db, so git-mode upgrade/deploy applies the reduced list — a genuine duplication/drift; the superset-fix is safe and behavior-preserving.

## 5. [高] 两份迁移清单都缺少 ORM 已定义且业务在用的列（cisco_list_ids、ai_settings.batch_size 等）

- **位置**: `native/nms.sh:1298`
- **类别**: correctness | **区域**: native-deploy | **是否改变行为**: 否

**证据**: ORM 定义见 backend/app/models/device_template.py：MonitoringTemplate.cisco_list_ids（JSON）、AISettings.batch_size/ai_concurrency/test_concurrency/test_retries。这两列被业务代码实际读写：backend/app/routers/snmp_templates.py:292 `t.cisco_list_ids = data.cisco_list_ids`、backend/app/routers/ai_settings.py:72 `config.batch_size = data.batch_size`、backend/app/routers/mib_manager.py:513 `ai_config.batch_size`。但 native/nms.sh 的迁移清单（942-951 与 1285-1306）只列了 monitoring_templates.mib_file_ids/source 和 ai_settings.request_timeout/group_timeout，没有 cisco_list_ids 与 batch_size/ai_concurrency/test_concurrency/test_retries。由于 backend/app/database.py:43 只用 `Base.metadata.create_all`（只建缺失的表、绝不会给已存在的表补列），升级后的老库会缺这些列，INSERT/SELECT 时报 Unknown column——而迁移语句全部带 `2>/dev/null || true`，迁移期完全静默，错误推迟到运行时才暴露。

**建议修法**: native/nms.sh 在 monitoring_templates 段补 `ALTER TABLE monitoring_templates ADD COLUMN cisco_list_ids JSON;`，在 ai_settings 段补 batch_size/ai_concurrency/test_concurrency/test_retries 四列；更稳妥的做法是先按下条把两条清单一，再用 Alembic（本仓库已有 backend/alembic 基础）替代手写 ALTER。

**验证者修正的修法**: Add the missing columns to BOTH migration lists in native/nms.sh, mirroring the existing idempotent style. In `_auto_migrate_db` after line 1303 insert: `$M "ALTER TABLE monitoring_templates ADD COLUMN cisco_list_ids JSON;" 2>/dev/null || true` and after line 1305 insert `$M "ALTER TABLE ai_settings ADD COLUMN batch_size INT DEFAULT 100;" 2>/dev/null || true`, `ADD COLUMN ai_concurrency INT DEFAULT 3`, `ADD COLUMN test_concurrency INT DEFAULT 3`, `ADD COLUMN test_retries INT DEFAULT 1` (defaults match the ORM at device_template.py:170-181). Mirror the same five lines into the `_show_changes` list after line 955. Guarding is unchanged (`2>/dev/null || true`), so re-runs on DBs that already have the columns are no-ops, and since columns set with DEFAULT backfill existing rows, the additive change cannot break existing installs. (Note: test_concurrency/test_retries are currently unused by routers but are non-nullable in the ORM, so a missing column still breaks AISettings SELECTs.) Longer term, replacing both hand-written lists with the already-present Alembic baseline would prevent this class of drift, but that is a larger change and is not required for this fix.

**验证结论**: Verified: both nms.sh migration lists (952-957 and 1296-1305) omit cisco_list_ids and ai_settings batch_size/ai_concurrency/test_concurrency/test_retries that the ORM defines and routers read/write, while create_all (database.py:43) never adds columns to existing tables and all ALTERs are silenced by `2>/dev/null || true`.

## 6. [高] push.sh 在 set -e 下用 ((UPLOADED++))，上传第 1 个文件后脚本立刻中止

- **位置**: `native/push.sh:99`
- **类别**: correctness | **区域**: native-deploy | **是否改变行为**: 否

**证据**: 脚本第 7 行 `set -euo pipefail`；第 92 行 `UPLOADED=0`；第 93-103 行循环内成功分支为 `if scp -q ...; then echo "OK"; ((UPLOADED++))`。当 UPLOADED=0 时 `((UPLOADED++))` 作为表达式求值为旧值 0，算术命令返回退出码 1，在 set -e 下直接终止整个脚本。本地实测：`bash -c 'set -euo pipefail; x=0; ((x++)); echo AFTER'` 无任何输出，退出码 1（去掉 set -e 后正常打印 AFTER x=1）。因此 push.sh 只会真正上传第 1 个成功文件，之后既不打印进度也不再上传剩余文件，第 106 行 `Uploaded $UPLOADED/...` 永远不会执行。

**建议修法**: native/push.sh:99 改为 `UPLOADED=$((UPLOADED + 1))`（算术赋值不返回失败状态），或在自增后追加 `|| true`；建议同时把第 92 行起的计数改为 `UPLOADED=$((...))` 形式，避免同类问题。

**验证者修正的修法**: native/push.sh:117: change `((UPLOADED++))` to `UPLOADED=$((UPLOADED + 1))`. Note the finding's cited line numbers are stale: `set -euo pipefail` is at line 7 (matches), but `UPLOADED=0` is at line 110 (not 92) and the `((UPLOADED++))` is at line 117 (not 99). This is the only arithmetic increment of that form in the file.

**验证结论**: Confirmed real: line 7 is `set -euo pipefail`, line 110 sets `UPLOADED=0`, and the success branch at line 117 runs `((UPLOADED++))`, which returns exit status 1 when the old value is 0, so `set -e` aborts the script after the first successful upload (reproduced locally: `set -euo pipefail; x=0; for i in 1 2 3; do echo loop $i; ((x++)); echo inc $x; done` prints only "loop 1" then exits 1). The fix changes only the counter increment, is a pure local-script logic change requiring no device/DB, and not covered by the listed completed optimizations.

## 7. [高] analyze_mib 增量模式仍逐 OID 查询 ParsedOid(N+1)

- **位置**: `backend/app/routers/mib_manager.py:496`
- **类别**: perf | **区域**: routers | **是否改变行为**: 否

**证据**: stream_progress() 的增量过滤循环 `for o in oids:`(第 493 行)里,每个 OID 都执行一次 `po_result = await session.execute(select(ParsedOid).where(ParsedOid.oid == oid_val))`(第 496 行)。一个 MIB 文件通常解析出成百上千个 OID,因此进入 AI 分析前会先发出 N 条 SELECT。同文件 upload_mib(第 118-121 行)与 get_available_oids(第 712-715 行)已改为批量 `in_()` 查询——只有此处漏改。

**建议修法**: 在循环前一次性查询:收集 `oid_list = [o.get('oid','') for o in oids if o.get('oid')]`,用 `select(ParsedOid).where(ParsedOid.oid.in_(oid_list))` 建 `po_map = {po.oid: po}`,然后循环内用 `po_map.get(oid_val)` 判断是否已有描述。改 mib_manager.py:489-503。

**验证者修正的修法**: Replace backend/app/routers/mib_manager.py:490-503 with a single batch query (mirroring the already-fixed get_available_oids at lines 710-715), while preserving the description check:

    async def stream_progress():
        # 增量模式：跳过已有描述的 OID
        existing_count = 0
        incremental_oids = []
        valid_oid_vals = [o.get("oid", "") for o in oids if o.get("oid")]
        po_map = {}
        if valid_oid_vals:
            po_rows = await session.execute(
                select(ParsedOid).where(ParsedOid.oid.in_(valid_oid_vals))
            )
            po_map = {po.oid: po for po in po_rows.scalars().all()}
        for o in oids:
            oid_val = o.get("oid", "")
            po = po_map.get(oid_val) if oid_val else None
            if po and (po.description_zh or po.description_en):
                existing_count += 1
            else:
                incremental_oids.append(o)

Note: keep the `po.description_zh or po.description_en` condition — the original suggestion's "用 po_map.get(oid_val) 判断是否已有描述" is imprecise; looking up the row alone is not the same as checking it has a non-empty description.

**验证结论**: Confirmed at mib_manager.py:493-497: analyze_mib's incremental filter issues one SELECT per OID, while its sibling upload_mib (118-121) and get_available_oids (712-715) were already batched, so it is a real missed N+1 that can be fixed with the identical, behavior-preserving batch pattern.

## 8. [高] get_template_available_oids 逐 OID 查描述(N+1)

- **位置**: `backend/app/routers/snmp_templates.py:334`
- **类别**: perf | **区域**: routers | **是否改变行为**: 否

**证据**: get_template_available_oids(第 312-344 行)在 `for fid in all_file_ids` 内嵌套 `for o in f.parsed_oids`,每个新 OID 都执行 `po_result = await session.execute(select(ParsedOid).where(ParsedOid.oid == oid))`(第 334 行)。这是 mib_manager.get_available_oids 的同构代码,后者已在本次优化中改为批量 `in_()`(mib_manager.py:712-715),本函数未同步修改。关联多个 MIB/大 Cisco 列表时会产生数百至上千条查询。

**建议修法**: 先收集本次所有去重后的 `oid` 到列表,循环外做一次 `select(ParsedOid).where(ParsedOid.oid.in_(oid_list))` 得到 `desc_map`,循环内 `po = desc_map.get(oid)`。改 snmp_templates.py:327-342。

**验证者修正的修法**: Mirror mib_manager.get_available_oids exactly. In backend/app/routers/snmp_templates.py:319-344, replace the inline query with: accumulate a dict during the nested loop, then one batch query. Concretely:
- 319-320: keep `oid_meta: dict[str, dict] = {}` instead of `all_oids`/`seen` iteration order (or keep `seen` + a parallel list).
- 330-335: inside the dedupe branch, store `oid_meta[oid] = {"name": o.get("name", ""), "mib_source": f.filename}` and drop line 334's `po_result = await session.execute(...)`.
- After the `for fid` loop (new lines ~336-341), add: `desc_map = {}` and `if oid_meta: po_rows = await session.execute(select(ParsedOid).where(ParsedOid.oid.in_(list(oid_meta.keys())))); desc_map = {po.oid: po for po in po_rows.scalars().all()}`.
- Finally rebuild `all_oids` from `oid_meta` + `desc_map.get(oid)` (identical dict shape: oid/name/desc_zh/desc_en/mib_source), then return.

**验证结论**: get_template_available_oids issues one ParsedOid query per deduped OID inside a nested loop (snmp_templates.py:334), while the isomorphic get_available_oids was already migrated to a single in_() batch (mib_manager.py:710-715); the rewrite yields identical output so it is safe.

## 9. [高] list_imported 逐模板 count(N+1)且每次 GET 都跑 ALTER TABLE

- **位置**: `backend/app/routers/zabbix_templates.py:323`
- **类别**: perf | **区域**: routers | **是否改变行为**: 否

**证据**: list_imported(第 299-337 行)对每个模板执行一次 `select(func.count()).select_from(TemplateItem).where(TemplateItem.template_id == t.id)`(第 323-328 行),即 N 个模板发 N 条 count——snmp_templates.list_templates 的同类 N+1 已改 GROUP BY,这里没有。此外该 GET 处理函数在第 302-310 行每次都执行 `ALTER TABLE monitoring_templates ADD COLUMN source ...` 再 commit/rollback,把 DDL 迁移塞进了读接口,每次列表请求都产生一次失败的 DDL + 事务回滚。

**建议修法**: 1) 计数改为单条 `select(TemplateItem.template_id, func.count()).where(TemplateItem.template_id.in_(ids)).group_by(...)`(改 zabbix_templates.py:322-337)。2) 删除 302-310 行的 ALTER TABLE,迁移改由 Alembic 承载(该列显然已存在)。

**验证者修正的修法**: 1) zabbix_templates.py:322-337 — hoist the count out of the loop: before the loop build `ids = [t.id for t in templates]`, then if ids run one `select(TemplateItem.template_id, func.count()).where(TemplateItem.template_id.in_(ids)).group_by(TemplateItem.template_id)`, build a dict, and in the loop use `item_count = counts.get(t.id, 0)`. `func` and `TemplateItem` are already imported (lines 10, 14). 2) zabbix_templates.py:302-310 — delete the whole try/except ALTER TABLE block; `source` already exists in the model (models/device_template.py:69) and the Alembic baseline (alembic/versions/fb2e278a066a_baseline_schema.py:134), so the DDL only ever fails and forces a rollback per request. Keep the surrounding try/except that returns [] on query failure (318-320) so a stale DB still degrades gracefully instead of 500ing.

**验证结论**: Confirmed: the GET handler issues one count query per template (322-328) and runs a knowingly-failing ALTER TABLE + rollback on every request (302-310); both fixes are local and safe, with the column already present in the model and Alembic baseline.

## 10. [高] 全局告警规则(device_id 为 NULL)只采样'最后上报的一台设备',并在未越限时误清空所有设备的告警

- **位置**: `backend/app/services/alert_engine.py:54`
- **类别**: correctness | **区域**: services | **是否改变行为**: 是

**证据**: L54-66 的 metric_stmt 在 rule.device_id 为空时不做设备过滤,只 `order_by(collected_at.desc()).limit(1)` 取全库最新的一条 DeviceMetric;L75-101 用这一条样本决定是否告警,告警只针对 latest_metric.device_id 创建;而 L116-124 的 else 分支在样本未越限时,用 `Alert.alert_rule_id == rule.id, resolved_at is None`(无 device 过滤)把该规则下**所有设备**的未解决告警全部 resolved。全局规则是一等公民:models/alert.py:18-21 注释 'NULL means global rule for all devices',routers/alerts.py:16 `device_id: str | None = None`,L52 明确查询 `AlertRule.device_id.is_(None)`。结果:A 设备持续超阈值可能因 B 设备后上报且未超阈值而永远不告警,同时 A 已产生的告警被错误自动解决。

**建议修法**: 在 backend/app/services/alert_engine.py:51 的规则循环内,当 rule.device_id 为空时改为对每个 SNMP 设备分别取最新 metric(用 group-by/窗口子查询取每 device 最新一行),按设备分别判定触发与解决;解决分支 L116-118 增加 `Alert.device_id == <本次判定的设备>` 过滤。

**验证者修正的修法**: In backend/app/services/alert_engine.py, keep the device-specific path (L59-62) as-is; for global rules (rule.device_id is None) fetch the latest metric per device instead of one global row. Replace L64-69 with a per-device latest query: build a subquery `select(DeviceMetric.device_id, func.max(DeviceMetric.collected_at).label("mx")).where(DeviceMetric.metric_name==rule.metric_name, DeviceMetric.metric_type==rule.metric_type).group_by(DeviceMetric.device_id).subquery()` and join DeviceMetric on (device_id, collected_at==mx), then iterate `.scalars().all()` (not scalar_one_or_none). Move the condition/trigger/resolve block (L74-124) inside a `for latest_metric in latest_metrics:` loop so each device is judged independently, and add `Alert.device_id == latest_metric.device_id` to the else-branch resolve query (L116-120). Import func from sqlalchemy (currently only select is imported, L6). Commit per device or once after the loop. This is testable with the existing pytest+async_session infra (tests/conftest.py) using seeded DeviceMetric rows for two devices.

**验证结论**: Exact line numbers match: global rules sample one DB-wide latest metric and the resolve branch (L116-124) lacks a device filter, so per model/router semantics (alert.py:18-21, alerts.py:16/52) this cross-contaminates devices; fix restores intended per-device behavior without breaking device-specific rules.

## 11. [高] _collector_tasks 从不清理已完成任务 → 每台设备整个进程生命周期只采集一次

- **位置**: `backend/app/services/snmp_collector.py:56`
- **类别**: correctness | **区域**: services | **是否改变行为**: 是

**证据**: L18 注释声明 'Track running collection tasks by device_id',L56 用 `if device.id not in _collector_tasks:` 作为唯一的调度门,L62 `_collector_tasks[device.id] = task` 存入后永不删除。全文件搜索 _collector_tasks 仅出现在 L19/29/36/38/56/57/62/66/68/69,没有任何 add_done_callback 或 pop/discard。_collect_device_metrics(L77-215) 是单次执行后返回的协程。因此任务完成后 entry 仍留在 dict 中,后续每一轮 _collection_loop(L44) 的 L56 判断恒为 False,永远不会重新创建任务;只有设备被禁用/删除(L66-69)才会清掉。

**建议修法**: 在 backend/app/services/snmp_collector.py:62 之后补 `task.add_done_callback(lambda t, did=device.id: _collector_tasks.pop(did, None))`(或改用 set 存活跃任务 + discard),使任务完成后 entry 被移除,恢复'周期性轮询'语义。

**验证结论**: Confirmed at snmp_collector.py:56/62 — _collector_tasks entries are never removed on task completion (no pop/discard/add_done_callback anywhere; only disabled-device cleanup at L66-69), so each device's one-shot task (L77) blocks re-scheduling forever, defeating the periodic loop; the proposed add_done_callback fix restores intended behavior without breaking the no-overlap guard or the cancel path.

## 12. [高] snmp_get_many 对含小数点的数值静默丢弃(int() 异常被吞),且 _coerce 同病且已成死代码

- **位置**: `backend/app/services/snmp.py:155`
- **类别**: correctness | **区域**: tests-eng | **是否改变行为**: 是

**证据**: snmp.py:155 `result[name] = int(val) if str(val).replace("-", "").replace(".", "").isdigit() else val` — 判定用的是「去掉小数点后」的字符串("42.5"→"425".isdigit()==True),但 int() 作用在原始 "42.5" 上 → ValueError → 被外层 `except Exception: pass`(snmp.py:157-158)吞掉,该键整条丢失。backend/tests/test_snmp_service.py:55-56 明确断言此行为(`# 与原实现一致:非整数浮点字符串("42.5")因 int() 失败被跳过` / `assert "c" not in res`),即测试把数据丢失当作正确行为固化。消费者 snmp_collector.py:142-145 用 `float(value)` 期望拿到数值,任何带小数点的 SNMP 值(温度/负载/部分 Gauge)或点分数值会被静默丢。另 snmp.py:53-64 的 `_coerce()` 有完全相同的缺陷,且全仓 grep 无任何调用方(死代码)。

**建议修法**: 在 snmp.py:53-64 把 `_coerce` 改为正确实现并复用:`s=str(val); try: return int(s) except ValueError: try: return float(s) except ValueError: return val`;把 snmp.py:155 的内联逻辑替换成调用该函数(消除重复);同步修正 backend/tests/test_snmp_service.py:56 断言为 `res["c"] == 42.5`。

**验证者修正的修法**: backend/app/services/snmp.py:53-64 — fix `_coerce` so the numeric branch matches what it converts:
```python
def _coerce(val):
    """归一化 pysnmp 返回值:bytes 解码、整数/浮点转数值、其余保留。"""
    try:
        if hasattr(val, "_value"):
            val = val._value
        if isinstance(val, bytes):
            val = val.decode("utf-8", errors="replace")
        s = str(val)
        try:
            return int(s)
        except ValueError:
            try:
                return float(s)
            except ValueError:
                return val
    except Exception:
        return None
```
backend/app/services/snmp.py:148-157 — replace the inline block (lines 149-157) with a reuse of `_coerce`, keeping the per-key skip-on-failure semantics:
```python
for (name, _oid), vb in zip(oid_map.items(), var_binds):
    try:
        val = _coerce(vb[1])
        if val is not None:
            result[name] = val
    except Exception:
        pass
```
(Using `if val is not None` preserves the existing "skip key" contract rather than inserting a `None` entry.) Then update backend/tests/test_snmp_service.py:55-56 to assert the float is retained:
```python
    # 浮点字符串("42.5")现应被正确转换为 float
    assert res["c"] == 42.5
```
All `snmp_get_many` consumers (snmp_collector.py:145, :171) already do `float(value)` and filter `None`/`""`, so returning 42.5 instead of dropping the key only adds data; no other caller exists.

**验证结论**: snmp.py:155's digit guard strips the dot so "42.5" passes the guard but int("42.5") raises and is swallowed by except (156-157), silently dropping the key; the same flaw is in the caller-less _coerce (53-64), and the test at lines 55-56 codifies the data loss — a real, unit-testable bug not covered by any completed optimization.

## 13. [高] 107 个路由端点(4802 行)零测试,缺最基础的路由装配 smoke test

- **位置**: `backend/tests/conftest.py:1`
- **类别**: test-gap | **区域**: tests-eng | **是否改变行为**: 否

**证据**: tests/ 仅 3 个文件共 26 用例(test_pure 17 / test_snmp_service 7 / test_retention 2),全部直接 import 服务或工具函数;conftest.py 只有 4 行 sys.path 注入,无 app/TestClient fixture;`grep -rn "TestClient|app\." tests/` 无任何命中。而 app/routers/*.py 共 4802 行、`@router.(get|post|...)` 共 107 个端点,加上 app/main.py 的 include_router 装配,完全没有装配级验证。历史上 doc 记录的 BUG-1(devices.py 未导入 MibFile → 运行时 NameError)与 RE-1(同名路由被覆盖成死代码)正属此类,仅靠一次性脚本验证后「脚本已清理不残留」。

**建议修法**: 新增 backend/tests/test_routes.py:(1) `from app.main import app` 冒烟,断言 app.routes 非空且 (method,path) 无重复(防止路由覆盖);(2) 用 fastapi testclient.TestClient(app) 测不触库的 /api/health、/api/version、/api/settings,断言 200 + 结构。无需 DB,可直接在现有 conftest 下运行。

**验证者修正的修法**: 新增 backend/tests/test_routes.py(只需此一个新文件,不改任何现有文件)。

1) 装配冒烟: `from app.main import app`(安全,无 DB:`app/database.py:5-10` 的 create_async_engine 是惰性的,`init_db()` 只在 `app/main.py:47` 的 lifespan 中调用)。
2) 路由覆盖检测: 遍历 app.routes,对带 methods 的路由收集 (method.upper(), path),断言无重复,以防 RE-1 式同名路由被覆盖。注意 path 已是含 prefix 的完整路径。
3) 端点测试: 用 `client = TestClient(app)`(**不要**用 `with TestClient(app) as c:`,否则会触发 `app/main.py:46-66` 的 lifespan → `init_db()` 需要 MySQL 而失败)。GET `/api/health`、`/api/version`、`/api/settings`(定义于 `app/main.py:157/162/166`),断言 200 及返回结构(`/api/settings` 经 `from .services import icmp_monitor`,该模块 import 无副作用)。

无需修改 conftest.py;现有 `sys.path` 注入(`conftest.py:5`)已足够 `import app`。

**验证结论**: 当前代码确实只有 3 个纯逻辑测试文件(26 用例)、无 TestClient/app fixture,而 routers 有 4802 行/107 端点且仅经一次性脚本验证过装配;新增只读 smoke test 不触碰任何生产代码,且可完全离线(import 与 3 个端点均不依赖 DB)运行,故真实且安全可修。

## 14. [中] alerts.js 与 app.js 缺少 ?v= 缓存清除参数,发版后浏览器会继续使用旧脚本

- **位置**: `frontend/index.html:160`
- **类别**: correctness | **区域**: frontend-core | **是否改变行为**: 否

**证据**: index.html:160 `<script src="/static/js/pages/alerts.js"></script>` 与 161 `<script src="/static/js/app.js"></script>` 没有 `?v=`,而其余全部 30+ 个 css/js 资源都带 `?v=1.2.89.dev15`。native/gen_version.py:187 的缓存清除实现为 `html = re.sub(r'\?v=[\w.-]+"', f'?v={new_ver}"', html)`,只重写已存在的 `?v=`,因此这两个文件(含整个 SPA 的路由 webcurl 入口 app.js)永远不会被更新版本号。

**建议修法**: 给 frontend/index.html:160、161 两个 script 补上 `?v=1.2.89.dev15`(与其余资源一致),使其进入 gen_version.py:187 的替换范围;后续发版即可正确刷新。

**验证结论**: index.html:160/161 确实缺少 ?v=,而 gen_version.py:187 的正则只重写已存在的 ?v=,故这两文件永不被版本刷新;补上与其余资源一致的 ?v=1.2.89.dev15 是纯缓存清除、无行为风险。

## 15. [中] App.toast / 路由错误页把消息直接插入 innerHTML(未转义)

- **位置**: `frontend/js/app.js:149`
- **类别**: correctness | **区域**: frontend-core | **是否改变行为**: 否

**证据**: app.js:149 `toast.innerHTML = \`<span>${message}</span>\`;` 未做转义;调用方普遍传入用户或服务端数据,例:devices.js:304 `App.toast(name + ' ' + T('updated_success'), ...)`(name 是用户填写的设备名)、add-device.js:224 `App.toast(T('device_added_success') + ': ' + res.name, ...)`、mib-manager.js:151 `App.toast(... + file.name, ...)`。app.js:127-131 的错误页同样把 `e.message` 直接插入 innerHTML。项目其它 155 处渲染都走 Format.esc,此处不一致。

**建议修法**: app.js:149 改为 `toast.textContent = message;`(或 `Format.esc(message)`);app.js:131 的 `e.message` 同样用 Format.esc 转义。已确认无调用方依赖在 toast 中传 HTML(全量搜索 toast 调用无 HTML 片段)。

**验证者修正的修法**: frontend/js/app.js:149 → `toast.innerHTML = \`<span>${Format.esc(message)}</span>\`;` (preserves the existing <span> wrapper, which no CSS targets) — or equivalently `toast.textContent = message;`. frontend/js/app.js:130 → `<p>${Format.esc(e.message)}</p>` (inside the pageContainer error template at lines 127-131). No caller passes HTML (verified by full grep of App.toast calls), so escaping changes nothing for existing callers.

**验证结论**: app.js:149 and app.js:130 insert user/server data (device names, filenames, error messages) into innerHTML unescaped, unlike the rest of the codebase; no toast caller passes HTML so escaping is behavior-preserving and safe.

## 16. [中] FrontPanel 自动刷新定时器泄漏:离开设备详情页后仍每 15s 轮询接口

- **位置**: `frontend/js/components/front-panel.js:36`
- **类别**: state-mgmt | **区域**: frontend-core | **是否改变行为**: 否

**证据**: front-panel.js:36-39 `this.refreshTimer = setInterval(async () => { this.ports = await API.getFrontPanelPorts(panelId); this._drawPanel(); }, CONSTANTS.POLLING.METRICS);`。全项目搜索 `FrontPanel.` 仅有 device-detail.js:133 `FrontPanel.render(...)` 一处调用,front-panel.js:196-203 定义的 `destroy()` 无任何调用;device-detail.js:26-32 的 `DeviceDetailPage.destroy()` 只清理 `this.refreshTimer`,未清理 FrontPanel 的定时器。除此外 render() 每次被调会覆盖 refreshTimer 导致旧定时器丢失引用。

**建议修法**: 在 frontend/js/pages/device-detail.js 的 destroy() 内加 `if (typeof FrontPanel !== 'undefined') FrontPanel.destroy();`;并在 front-panel.js:render() 开头先 `clearInterval(this.refreshTimer)` 做防御。

**验证者修正的修法**: Two-line teardown fix, no behavior regression. (1) In frontend/js/pages/device-detail.js, inside destroy() (lines 24-31), add before the WS cleanup: `if (typeof FrontPanel !== 'undefined' && FrontPanel.destroy) FrontPanel.destroy();` — destroy() is idempotent (it null-checks refreshTimer), so it is safe even when no front panel was rendered. (2) In frontend/js/components/front-panel.js, at the top of render() (line 15, right after `if (!container) return;`) add: `if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }` to defensively kill a stale interval from a prior render. This stops the 15s leak and the double-poll/double-draw caused by orphaned timers. Neither line changes the visible rendering of the panel, only stops leaked polling after navigation away.

**验证结论**: Confirmed: the 15s setInterval in front-panel.js:36 is never cleared because FrontPanel.destroy() has no callers and DeviceDetailPage.destroy() (device-detail.js:24-31) only tears down page-level state, so leaving the device detail page leaves an orphaned polling timer (and a second render orphans the first timer too).

## 17. [中] i18n 字典缺 loading_devices 键,拓扑页会显示裸字符串

- **位置**: `frontend/js/i18n.js:78`
- **类别**: correctness | **区域**: frontend-core | **是否改变行为**: 否

**证据**: 将 frontend/js 内所有 `T('...')` 键与 i18n.js 的 zh/en DICT(第 7-329 行)做全量 diff,唯一缺失键为 `loading_devices`。pages/topology.js:81 `<div class="topo-loading">${T('loading_devices')}</div>` 使用它;i18n.js:333 `t(key){ return (... && ...[key]) || key; }` 找不到时原样返回键名,故加载拓扑时界面会直接显示英文键名 `loading_devices` 而非“加载中...”。

**建议修法**: 在 i18n.js zh 字典(第 78 行 `loading:'加载中...'` 附近)与 en 字典对应位置补 `loading_devices:'加载中设备...'` / `'Loading devices...'`。

**验证者修正的修法**: 在 frontend/js/i18n.js 补键:zh 块第 78 行 `loading:'加载中...',` 之后加 `loading_devices:'加载中设备...',`;en 块第 239 行 `loading:'Loading...',` 之后加 `loading_devices:'Loading devices...',`。(等价的最小改法:把 frontend/js/pages/topology.js:81 的 `T('loading_devices')` 改为已存在的 `T('loading')`,无需新增键,同样安全。)

**验证结论**: 实测全量 diff 确认 `loading_devices` 是 frontend/js 中唯一在 zh/en 均缺失的 T() 键,topology.js:81 使用它且 .topo-loading 可见,加载时会显示裸键名;补键不改动任何现有键,零风险。

## 18. [中] 全局 T() 只读 nms_device_types,忽略 nms_type_overrides,改名的内置设备类型不生效

- **位置**: `frontend/js/i18n.js:397`
- **类别**: correctness | **区域**: frontend-core | **是否改变行为**: 否

**证据**: i18n.js:396-403 的 window.T 仅检查 `JSON.parse(localStorage.getItem('nms_device_types') || '[]')`。而 device-types.js:233 在编辑“内置类型”时写入的是另一个键 `nms_type_overrides`(`ov[key]={zh,en,cat}; this._set('nms_type_overrides',ov)`),只有 device-types.js 自己的 _allTypes() 会读它。devices.js:95 `T(d.device_type)`、device-models.js:267 `T(m.device_type)` 用 T() 渲染类型标签,因此被改过名称的内置类型(如把“路由器”改掉)在设备列表/型号列表里仍显示旧名。

**建议修法**: 在 i18n.js:395-405 的 T() 中同时读取 `nms_type_overrides`,若其含该 key 则优先返回覆盖后的 zh/en(与 device-types.js 的写入键对齐)。

**验证者修正的修法**: In `frontend/js/i18n.js:394-405`, add an `nms_type_overrides` lookup to `window.T` before the existing custom-types branch:

```js
window.T = function(k) {
    var lang = (window.I18N && window.I18N.lang) || 'zh';
    try {
        var ov = JSON.parse(localStorage.getItem('nms_type_overrides') || '{}');
        if (ov[k]) return (lang === 'zh') ? (ov[k].zh || k) : (ov[k].en || k);
    } catch(e) {}
    try {
        var customTypes = JSON.parse(localStorage.getItem('nms_device_types') || '[]');
        for (var i = 0; i < customTypes.length; i++) {
            if (customTypes[i].key === k) {
                return (lang === 'zh') ? customTypes[i].zh : customTypes[i].en;
            }
        }
    } catch(e) {}
    return window.I18N.t(k);
};
```

Keys are disjoint (device-types.js:208 blocks a new custom key from colliding with any existing built-in key), so the ordering vs. the custom-types loop does not matter. This only adds a read of a previously-unread localStorage key; it does not affect any other `T()` caller since overrides are keyed solely by built-in device-type keys (router/switch/firewall/...). No DB or real device needed to verify — it is a pure client-side label change matching what the user already sees on the device-types page.

**验证结论**: Confirmed: `window.T` (i18n.js:397) reads only `nms_device_types`, while built-in renames are stored under `nms_type_overrides` (device-types.js:233) and read only by that page's `_allTypes()` (device-types.js:53), so `T()`-based labels in devices.js:95 and device-models.js:267 keep showing the default dict name; the additive localStorage read is safe and changes nothing else.

## 19. [中] 设备名/IP 未转义直接拼进 HTML(存储型 XSS,来源含扫描发现的不可信主机名)

- **位置**: `frontend/js/pages/device-types.js:180`
- **类别**: correctness | **区域**: frontend-pages | **是否改变行为**: 否

**证据**: device-types.js:180 `devicesUsing.map(d=>'<div ...>• <b>'+d.name+'</b> ('+d.ip_address+') — '+d.device_type+'</div>')`;同文件 243 行 `'<div ...><b>'+d.name+'</b> ('+d.ip_address+')</div>'`;device-models.js:196 `'<b>'+u.model.model_name+'</b> used by: '+u.devices.map(d=>d.name+'('+d.ip_address+')')`。d.name 可由 discovery 扫描到的 hostname 经 approveDevice 写入(不可信网络数据),也可在 add-device 表单任意输入,均未走 Format.esc。

**建议修法**: 三处统一包 Format.esc: device-types.js:180、device-types.js:243、device-models.js:196 中把 d.name / d.ip_address / u.model.model_name / d.device_type 用 Format.esc() 包裹(与同文件 97-98 行的做法一致)。

**验证者修正的修法**: Wrap the untrusted device fields with Format.esc in all three spots:
1. frontend/js/pages/device-types.js:180 — replace `'<b>'+d.name+'</b> ('+d.ip_address+') — '+d.device_type` with `'<b>'+Format.esc(d.name)+'</b> ('+Format.esc(d.ip_address)+') — '+Format.esc(d.device_type)`.
2. frontend/js/pages/device-types.js:243 — replace `'<b>'+d.name+'</b> ('+d.ip_address+')'` with `'<b>'+Format.esc(d.name)+'</b> ('+Format.esc(d.ip_address)+')'`.
3. frontend/js/pages/device-models.js:196 — replace `'<b>'+u.model.model_name+'</b> used by: '+u.devices.map(d=>d.name+'('+d.ip_address+')')` with `'<b>'+Format.esc(u.model.model_name)+'</b> used by: '+u.devices.map(d=>Format.esc(d.name)+'('+Format.esc(d.ip_address)+')')`.
No other change needed; Format.esc is already global and used elsewhere in the same files.

**验证结论**: Confirmed at device-types.js:180/243 and device-models.js:196 raw d.name/d.ip_address/d.device_type/model_name concatenated into innerHTML without Format.esc, while sibling lines in the same files already escape; wrapping with the existing Format.esc is purely additive and behavior-preserving for legitimate data.

## 20. [中] _testAbortController 永远是 null,"Test All" 的停止分支不可达,点 Stop 会再启动一轮测试

- **位置**: `frontend/js/pages/mib-manager.js:565`
- **类别**: state-mgmt | **区域**: frontend-pages | **是否改变行为**: 否

**证据**: mib-manager.js:561 `_testAbortController: null,`;唯一读取在 565 行 `if (this._testAbortController) { this._testAbortController.abort(); ... return; }`;全部赋值点(567、610 行)都只是 `= null`,从未被赋为 AbortController 实例。因此 565 行分支永不进入,588 行按钮切成 "Stop" 后再点只会重新执行 591 行的 batch-test-oid。

**建议修法**: 要么在 _testAllOids 启动时 `this._testAbortController = new AbortController()` 并把 signal 传给轮询/请求、在停止分支 abort;要么直接删掉 561-573 的停止逻辑并让按钮保持 "Test All" 文案。锚定 frontend/js/pages/mib-manager.js:561-573。

**验证者修正的修法**: Prefer dead-code removal over wiring an AbortController. In frontend/js/pages/mib-manager.js delete the unreachable stop branch 565-573, the orphaned declaration `_testAbortController: null,` at line 561, and the now-pointless `this._testAbortController = null;` at line 610; drop the transient "Stop" text at 588 (keep "Test All") and the duplicate reset at 612-613. This changes nothing functional (the branch never ran). Do NOT implement the suggested `new AbortController()` wiring: the batch run is a backend background task (backend/app/routers/snmp_templates.py:407-415 uses `asyncio.ensure_future(_run_batch_bg(data))` and returns immediately) with no cancel endpoint, so a client-side abort would falsely appear to stop the test. A genuine Stop would require a new backend cancellation endpoint keyed by job id — that is a feature addition needing real-device validation.

**验证结论**: Confirmed: `_testAbortController` is never assigned an AbortController (only ever null), so lines 565-573 are unreachable dead code — but the suggested AbortController fix cannot actually stop the backend fire-and-forget batch job (no cancel endpoint), so it is not safe to apply as written; only removing the dead branch is safe.

## 21. [中] OID 选择器把 MIB 描述用 innerHTML 插入,描述含 HTML 时可执行脚本

- **位置**: `frontend/js/pages/snmp-templates.js:277`
- **类别**: correctness | **区域**: frontend-pages | **是否改变行为**: 否

**证据**: snmp-templates.js:277 `descDiv.innerHTML = desc || (I18N.t('no_description')||'No description available');`。desc 来自 _selectOIDRow 的第 3/4 个实参,而这两个实参在 305 行用 `this._escJs(...)` 拼进 onclick —— _escJs(359 行)把 `<`/`>` 变成 `&lt;&gt;`,但 HTML 解析器在取出属性值时会把实体解码回真实 `<`/`>`,所以 JS 里拿到的是未转义的原始描述,再 innerHTML 就形成注入点(MIB 描述由上传的 MIB 文件内容决定)。同文件其余位置(如 306-308 行、267 行)均已用 Format.esc。

**建议修法**: frontend/js/pages/snmp-templates.js:277 改为 `descDiv.textContent = desc || ...`(或 Format.esc(desc))。

**验证结论**: Confirmed DOM XSS: snmp-templates.js:305 embeds descriptions via _escJs, whose &lt;/&gt; escaping is undone by HTML attribute entity-decoding when app.js:189 assigns box.innerHTML, so _selectOIDRow receives the raw value and line 277 sets it via innerHTML; switching line 277 to textContent is minimal and preserves the plain-text display behavior.

## 22. [中] _saveNotesToBackend 读 firstNode.canvasData(节点对象从未有此字段),每次存便签都把该节点 canvas_data 里的 color/width/height 静默清空

- **位置**: `frontend/js/pages/topology.js:1325`
- **类别**: correctness | **区域**: frontend-pages | **是否改变行为**: 否

**证据**: topology.js:1325 `const cd = firstNode.canvasData || {};` 之后 `cd.notes=...; cd.view=...` 再 `API.updateTopologyNode(firstNode.id, { canvas_data: cd })`(1330)。但全仓库 grep `canvasData` 只命中这一行;节点对象在 _buildNodes(210-227 行)和 _addDeviceToCanvasAt(1445-1461 行)构造时字段名是 snake_case 的原始 n.canvas_data 被拆解为 color/width/height,并不保留 canvasData。因此 cd 恒为 {},整份 canvas_data 被覆盖成 {notes, view},第一张节点上自存的 color/width/height(如导入的拓扑 _handleImportFile 1768-1773 写入的)在下次加载时丢失。

**建议修法**: 在 _buildNodes/节点构造时保留原始 canvas_data(例如新增 `canvasData: n.canvas_data || {}`),或在 _saveNotesToBackend 里改从缓存的原始节点数据取(参考 1330 行只发 {canvas_data:{...existing, notes, view}})。锚定 frontend/js/pages/topology.js:1325。

**验证者修正的修法**: 在三个节点构造点补上原始 canvas_data 字段：1) frontend/js/pages/topology.js:210-227 (_buildNodes 返回的节点对象) 里加 `canvasData: n.canvas_data || {},`；2) 1445-1461 (_addDeviceToCanvasAt 的 push) 里加 `canvasData: res.canvas_data || {},`；3) 1776-1792 (导入 push) 里加 `canvasData: res.canvas_data || {},`。其中第 1 处是关键(所有从服务端加载的节点都走这里)。这样 1325 的 `cd` 会带上服务端已有的 color/width/height/shape 等键，1330 的 PUT 就不再是覆盖空对象。注意：导入场景(res.canvas_data 恒为 undefined)因后端 add_node 从不写 canvas_data，其 color/width/height 本就不入库，因此建议修法里对导入点的示例描述应改为「保留由后续 PUT 写入的键(如 context-menu 设置的 color/shape)」，而非「导入写入的键」。

**验证结论**: firstNode.canvasData 从未在节点对象上赋值(grep 全仓仅 1325 一行命中)，故 cd 恒为 {}，1330 的 PUT 在后端 setattr 全量替换 canvas_data(topology.py:157-159)，会静默清掉该节点已有的 color/shape 等键；缺陷真实，但发现中「导入的 color/width/height 丢失」举例不成立——后端 add_node 根本不持久化 canvas_data(NodeCreate 无该字段，topology.py:124-138)，实际丢失的是 context-menu 对首节点写入的 color/shape。

## 23. [中] 预览路径 _renderRepoBrowserHtml 把每个模板文件行渲染了两遍

- **位置**: `frontend/js/pages/zabbix-templates.js:691`
- **类别**: correctness | **区域**: frontend-pages | **是否改变行为**: 否

**证据**: zabbix-templates.js:689-692 `for (const pk of parentKeys) { subHtml += this._renderSubGroup(pk, groups[pk], folder); subHtml += groups[pk].map(f => this._renderFileRow(f)).join(''); }`。而 _renderSubGroup 内部(133 行)已经 `subFiles.map(f => this._renderFileRow(f)).join('')` 渲染过同样的行。对照正常路径 _renderRepoBrowser(353-355 行)只调用 _renderSubGroup。结果是点预览(_showPreview → 413 行调用本函数)时同一个模板会出现两次(一次在折叠子组里隐藏,一次裸露在外)。

**建议修法**: 删除 frontend/js/pages/zabbix-templates.js:691 这一行 `subHtml += groups[pk].map(...)`(或直接让 _showPreview 复用 _renderRepoBrowser),与 353-355 行保持一致。

**验证结论**: Line 691 repeats rows already emitted by _renderSubGroup (line 133), and the normal path (353-355) lacks this extra line; deleting line 691 restores consistency with no loss of function.

## 24. [中] ICMP_CHECK_INTERVAL / SCAN_PING_TIMEOUT 配置定义了却从未被消费

- **位置**: `backend/app/config.py:27`
- **类别**: other | **区域**: models-utils | **是否改变行为**: 是

**证据**: config.py:27 定义 `ICMP_CHECK_INTERVAL`(默认 30),但全仓无任何读取点(仅 README.md:177、native/nms.sh:506、native/nms.ps1:312、NATIVE_DEPLOYMENT.md:167 文档/脚本中出现)。实际间隔由 services/icmp_monitor.py:19 的模块级硬编码 `_check_interval = 15` 决定(第 102 行 `await asyncio.sleep(_check_interval)`),故运维在部署脚本里设置 ICMP_CHECK_INTERVAL=30 完全无效。config.py:32 的 `SCAN_PING_TIMEOUT`(默认 0.5)同样零消费点(仅 docs/scripts),scanner.py 从未读取它。

**建议修法**: 二选一:(1) 让 icmp_monitor.py:19 改为 `_check_interval = settings.ICMP_CHECK_INTERVAL`,并在 scanner 的 ping 逻辑中消费 settings.SCAN_PING_TIMEOUT;(2) 若确认这些旋钮已废弃,删除 config.py:27、config.py:32 以及 README/native 脚本中对应的环境变量,避免误导运维。改动前先确认 scanner 的 ping 实现是否另有超时来源。

**验证者修正的修法**: Prefer the finding's option (2), which is behavior-neutral: remove backend/app/config.py:27 and backend/app/config.py:32, then drop the now-meaningless env vars from README.md:177,180; .env.example:18,23; native/nms.sh:506,510; native/nms.ps1:312,316; native/NATIVE_DEPLOYMENT.md:167,171,278,281. Do NOT use option (1) as-is: changing icmp_monitor.py:19 to settings.ICMP_CHECK_INTERVAL would flip the default interval 15s->30s, and consuming SCAN_PING_TIMEOUT in scanner._ping (scanner.py:458/469) would cut the ping3 timeout 2.0s->0.5s, risking missed hosts during discovery — both are behavior changes that need real-network validation. If the knobs must be honored, wire only icmp_monitor.py:19 (add `from .config import settings`; `_check_interval = settings.ICMP_CHECK_INTERVAL`) and leave scanner timeouts untouched.

**验证结论**: config.py:27/32 define ICMP_CHECK_INTERVAL and SCAN_PING_TIMEOUT with no runtime consumer (interval is the hardcoded icmp_monitor.py:19 `_check_interval = 15` / API-only set_interval; scanner._ping uses hardcoded timeouts), so the env knobs are inert dead config.

## 25. [中] SPA catch-all 路由缺少路径穿越校验,可读取 FRONTEND_DIR 之外的任意文件

- **位置**: `backend/app/main.py:190`
- **类别**: correctness | **区域**: models-utils | **是否改变行为**: 否

**证据**: main.py:187-193:`@app.get("/{full_path:path}")` 中 `file_path = FRONTEND_DIR / full_path`,随后直接 `if file_path.exists() and file_path.is_file(): return FileResponse(str(file_path))`。没有任何 `os.path.commonpath`/`Path.resolve().is_relative_to(FRONTEND_DIR)` 包含性校验。Starlette 的 `{full_path:path}` 会原样接收路径段(含 `..`),因此请求 `/../backend/app/config.py`(或 URL 编码的 `%2e%2e`)会命中该路由并返回项目源码(含 config.py 中的数据库口令)。该路由注册在所有 /api 路由之后,但 `/api/...` 之外的任意路径都会落入它。

**建议修法**: 在 main.py:187-193 加入容器化校验:先 `resolved = (FRONTEND_DIR / full_path).resolve()`,再 `if not resolved.is_relative_to(FRONTEND_DIR.resolve()): return FileResponse(index.html)`(或 404);再判断 exists/is_file。建议同时把前端静态资源改用 StaticFiles + 单独的 index.html 回退,避免手写路径拼接。

**验证者修正的修法**: In backend/app/main.py:187-193, add a containment check before serving. Replace the body of serve_spa with:

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve the SPA for any non-API route."""
        resolved = (FRONTEND_DIR / full_path).resolve()
        frontend_root = FRONTEND_DIR.resolve()
        if resolved.is_relative_to(frontend_root) and resolved.is_file():
            return FileResponse(str(resolved))
        return FileResponse(str(frontend_root / "index.html"))

This keeps the existing route registration order (after all /api routers) and preserves behavior for every legitimate request: real files under frontend/ are still served, and anything else (including confined/garbage paths) falls back to index.html exactly as today. Python 3.11 is required by backend/pyproject.toml:34, so Path.is_relative_to (3.9+) is available. Using the resolved path for FileResponse avoids a TOCTOU gap. Do NOT switch to return 404 for the fallback unless SPA deep-links are not needed — index.html fallback is what the current code does.

**验证结论**: main.py:187-193 is exactly as described — a raw `FRONTEND_DIR / full_path` join with only exists/is_file(), no containment check (grep found no is_relative_to/commonpath anywhere), and the `{full_path:path}` converter plus uvicorn's decode-without-normalize lets `..`/`%2e%2e` reach it, so files like backend/app/config.py are readable; the suggested containment fix is a pure hardening that preserves all legitimate SPA/static behavior.

## 26. [中] gen_version.py 重写 index.html 时未指定 newline="\n"，Windows 上产出 CRLF，与 .gitattributes (eol=lf) 冲突

- **位置**: `native/gen_version.py:188`
- **类别**: correctness | **区域**: native-deploy | **是否改变行为**: 否

**证据**: 第 188 行 `html_path.write_text(html, encoding="utf-8")`（Path.write_text 默认 newline=None，在 Windows 上把 \n 翻译为 os.linesep=CRLF）；对照第 224 行写 VERSION 时作者显式传了 `newline="\n"`，说明是有意为之却漏改这里。当前工作区实测：`file frontend/index.html` 输出 “with CRLF line terminators”，而 `git check-attr eol -- frontend/index.html` 期望 `eol: lf`，即 index.html 已被该函数改写成 CRLF。破坏后果：每次运行 gen_version.py 都会让 index.html 相对 git 成为脏文件；清单里记录的 MD5 是 CRLF 版本，而 nms.sh 部署后 _strip_cr 又会把安装副本改成 LF，两端不一致，do_verify 的 cmp 会持续报 OUTDATED。

**建议修法**: native/gen_version.py:188 改为 `html_path.write_text(html, encoding="utf-8", newline="\n")`，与第 224 行保持一致；并把工作区的 frontend/index.html 归一为 LF 后重新生成 VERSION。

**验证者修正的修法**: native/gen_version.py:188 改为 html_path.write_text(html, encoding="utf-8", newline="\n")，与 :224 写 VERSION 的做法一致；读取端 :186 的 read_text 无需改动（universal newlines 已把 CRLF 读成 LF）。修改后重跑 python native/gen_version.py，使工作区 frontend/index.html 与 VERSION 清单同时归一为 LF（git 索引/blob 本就是 LF，无需 renormalize）。

**验证结论**: gen_version.py:188 确未传 newline（:224 传了），Windows 上 write_text 默认把 \n 转成 CRLF；实测 index.html 为 CRLF 且 VERSION 记录的正是 CRLF 的 MD5（c27df47… vs LF 的 3a54aa34…），而 nms.sh _strip_cr 只把 INSTALL_DIR 副本改成 LF、do_verify:1232 用 cmp 比较 PROJECT_DIR 与 INSTALL_DIR，会持续 OUTDATED — 修法仅改行尾、不改逻辑，安全。

## 27. [中] TRACKED_FALLBACK 清单已过期，缺少 oid_descriptions.py / retention.py / ui.js（git 不可用时清单不全）

- **位置**: `native/gen_version.py:76`
- **类别**: dead-code | **区域**: native-deploy | **是否改变行为**: 否

**证据**: 第 36-116 行的 TRACKED_FALLBACK 声称 “Keep in sync with the deployed file set”。grep 确认该列表中完全没有 `oid_descriptions`、`retention`、`ui.js`。但这三个文件都真实存在且被引用：backend/app/utils/oid_descriptions.py、backend/app/services/retention.py、frontend/js/components/ui.js（均在 git ls-files 中，且 ui.js 被 frontend/index.html:139 加载）。git 不可用（或非 git 部署包）时会走 fallback，于是这些文件既不在 VERSION 清单里、也不会被 push.sh 的非 git 分支/完整性校验覆盖。

**建议修法**: native/gen_version.py:36-116 补齐三条路径（backend/app/utils/oid_descriptions.py、backend/app/services/retention.py、frontend/js/components/ui.js），或改为在 fallback 分支直接遍历 backend/frontend/native 目录，彻底去掉这份手工清单。

**验证者修正的修法**: Edit native/gen_version.py:36-116 (TRACKED_FALLBACK). Order is irrelevant because main() sorts at line 215; append the three runtime-critical paths, e.g. after line 67 add "backend/app/services/retention.py", after line 77 add "backend/app/utils/oid_descriptions.py", and after line 90 add "frontend/js/components/ui.js". For completeness, also add the other deploy-relevant-but-non-runtime entries that git would otherwise supply: "backend/alembic.ini", "backend/alembic/env.py", "backend/alembic/script.py.mako", "backend/alembic/versions/fb2e278a066a_baseline_schema.py". Do NOT replace the list with a blanket directory walk: that would pull in __pycache__/.venv/node_modules and drop the MANIFEST_EXCLUDE filtering, which is a larger behavioral change. Optionally add a guard in the no-git branch (lines 208-210) that asserts each fallback path resolves to a real file, so this drift is caught by the existing pytest suite instead of silently shipping.

**验证结论**: gen_version.py:36-116's manual TRACKED_FALLBACK is provably stale — oid_descriptions.py, retention.py and ui.js are runtime-imported/loaded yet absent, and the no-git branch (gen_version.py:209-210; push.sh:92-96) would omit them, so the fix (adding the paths) is additive and breaks nothing.

## 28. [中] location / 无条件发送 Connection: upgrade，使 upstream keepalive 32 失效

- **位置**: `native/nginx.conf:26`
- **类别**: perf | **区域**: native-deploy | **是否改变行为**: 是

**证据**: 第 9-12 行声明 `upstream nms_backend { keepalive 32; }`，但第 24-26 行对**所有**请求硬编码 `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`。Connection: upgrade 会让 nginx 对每个请求新建到 upstream 的连接，第 11 行的 keepalive 32 形同虚设；对普通 REST 请求发送 upgrade 语义也不正确（第 37-46 行的 /ws 已单独处理 WebSocket）。另外第 60-64 行 `expires 1d;` 已注入 Cache-Control，再 `add_header Cache-Control "public";` 会产生重复的 Cache-Control 响应头。

**建议修法**: native/nginx.conf 顶部加 `map $http_upgrade $connection_upgrade { default upgrade; '' close; }`，把 26 行与 41 行的 Connection 值改为 `$connection_upgrade`；删除 63 行的 `add_header Cache-Control "public"`（expires 已足够，且 ?v= 已做缓存击穿）。

**验证者修正的修法**: 原修法的 map 分支 `'' close;` 是错的:Connection: close(及当前的 upgrade)同样是非空值,仍会让 upstream 连接在响应后关闭,keepalive 32 依旧失效——nginx 官方要求 keepalive 场景下 Connection 头必须为**空串**(空值的 proxy_set_header 会被省略,HTTP/1.1 默认即为 keep-alive)。可直接执行的安全修法:
1) 在 native/nginx.conf:8 之后(第 9 行 upstream 之前,该文件被复制到 sites-available/conf.d,处于 http{} 上下文内)插入:
   map $http_upgrade $connection_upgrade {
       default upgrade;
       ''      '';
   }
2) 将 native/nginx.conf:26 `proxy_set_header Connection "upgrade";` 改为 `proxy_set_header Connection $connection_upgrade;`;第 41 行 /ws 可一同改为 $connection_upgrade(该路径客户端必带 Upgrade,行为不变),也可保持不变,二者皆安全。
3) 删除 native/nginx.conf:63 `add_header Cache-Control "public";`(第 62 行 expires 1d 已生成 Cache-Control: max-age=86400,重复头应去掉;若想保留 public 语义则应改为 `add_header Cache-Control "public, max-age=86400";` 并去掉 expires——二选一,勿重复)。
4) 最后 `nginx -t` 校验语法后 reload。

**验证结论**: nginx.conf:26 确实对所有请求硬编码 Connection: upgrade,与第 11 行 keepalive 32 冲突(非空 Connection 头会阻止 upstream 连接复用),问题真实且未被既有优化覆盖;但原建议的 map `'' close` 仍会发 Connection: close、依旧禁用 keepalive,需改为空串分支才真正生效。

## 29. [中] 安装写 /opt/nms/.version、部署写 /opt/nms/VERSION，do_status 读的是前者 → 升级后状态显示的版本永远过期

- **位置**: `native/nms.sh:44`
- **类别**: state-mgmt | **区域**: native-deploy | **是否改变行为**: 否

**证据**: 第 44 行 `VERSION_FILE="${INSTALL_DIR}/.version"`，第 518 行 do_install `echo "$CURRENT_VERSION" > "$VERSION_FILE"`；而 do_status 第 153-155 行判断并 `cat $VERSION_FILE`；do_deploy 第 978-983 行只 `cp "${SRC}/VERSION" "${DST}/VERSION"`，第 1464、1141 行读的也是 `${INSTALL_DIR}/VERSION`。deploy/update 从不更新 `.version`，于是 `sudo bash nms.sh status` 会一直显示首次安装时的旧版本号。

**建议修法**: 统一为单一文件：native/nms.sh:44 改为 `VERSION_FILE="${INSTALL_DIR}/VERSION"`，并删除 518 行或改成写入同一路径；或反向统一为 .version 并在 do_deploy 同步更新。

**验证者修正的修法**: Change only line 44: native/nms.sh:44 -> VERSION_FILE="${INSTALL_DIR}/VERSION". With this, the existing write at native/nms.sh:518 already targets the same file, and do_deploy (native/nms.sh:987, DST=INSTALL_DIR per :832) plus _sync_to_install (native/nms.sh:1361) keep /opt/nms/VERSION current, so do_status (native/nms.sh:153-154) reads the up-to-date version. Line 518 need not be deleted — it writes the same value just copied at :401, so it is harmless/redundant. No other change required; grep confirms .version is written only at :518 and read only at :153-154.

**验证结论**: Confirmed: install writes both /opt/nms/.version and /opt/nms/VERSION, do_status reads .version (line 153-154), while deploy/update only refresh /opt/nms/VERSION (lines 987, 1361), so status reports a stale version after upgrade — the single-line fix at line 44 is shell-only and safe.

## 30. [中] list_templates 用 len(t.items) 触达懒加载关系(未 selectinload)

- **位置**: `backend/app/routers/device_models.py:181`
- **类别**: perf | **区域**: routers | **是否改变行为**: 否

**证据**: device_models.list_templates(第 164-185 行)用普通 `select(MonitoringTemplate)`(第 170 行)取模板后,在第 181 行 `"item_count": len(t.items) if t.items else 0` 访问 `MonitoringTemplate.items` 关系。该关系在 models/device_template.py:87-89 未声明 lazy,即默认 lazy='select'。全仓对关系的访问(list_dashboards/racks/front_panels/get_dashboard_data)一律显式 `selectinload`,唯独此处没有。项目自己的 docs/OPTIMIZATION.md 第 50 行明确记载:`dashboard.widgets` 的这种 async 懒加载会抛 MissingGreenlet,并已用 selectinload 修复——本处是同一类问题(前端 add-device.js:245 用 try/catch 静默吞掉,故表现为模板下拉框为空而非报错)。而等价的已优化版本 snmp_templates.list_templates 已改为单条 GROUP BY 计数(第 92-99 行)。

**建议修法**: 改 device_models.py:164-185:用 `select(TemplateItem.template_id, func.count()).where(TemplateItem.template_id.in_([t.id for t in templates])).group_by(TemplateItem.template_id)` 得到计数表(与 snmp_templates.list_templates 一致),不再访问 t.items。

**验证者修正的修法**: backend/app/routers/device_models.py:170 的查询未 selectinload。最省事的等效修法是照抄同仓已验证的 snmp_templates.py:91-105:先把第 6 行 `from sqlalchemy import select` 改为 `from sqlalchemy import func, select`,再在 164-185 内 `templates = result.scalars().all()` 之后加:item_counts = {r[0]: r[1] for r in (await session.execute(select(TemplateItem.template_id, func.count()).where(TemplateItem.template_id.in_([t.id for t in templates])).group_by(TemplateItem.template_id))).all()} if templates else {},并把第 181 行改为 `"item_count": item_counts.get(t.id, 0)`(TemplateItem 已在第 10 行导入)。若想改动更小,也可仅在第 170 行 stmt 上加 `.options(selectinload(MonitoringTemplate.items))`(需 `from sqlalchemy.orm import selectinload`),但 GROUP BY 只取计数、更省内存,推荐前者。

**验证结论**: device_models.py:181 确实在 async 会话中访问未 selectinload 的 MonitoringTemplate.items(lazy 默认 select),会触发 MissingGreenlet 并被前端 try/catch 吞成空下拉框,而等价端点 snmp_templates.list_templates 已用 GROUP BY 计数修复,故为真实且可安全按同一模式修复的问题。

## 31. [中] approve_device 为一行日志加载整张 devices 表

- **位置**: `backend/app/routers/discovery.py:320`
- **类别**: perf | **区域**: routers | **是否改变行为**: 否

**证据**: approve_device 第 318-320 行:在 `logger.info` 里内联执行 `(await session.execute(select(Device))).scalars().all().__len__()`,把整张 devices 表全部 ORM 对象拉进内存,只为打印“total devices”这个计数。这是调试残留,每次纳管设备都会全表物化。

**建议修法**: 删除该调试计数;若确需计数,用 `select(func.count()).select_from(Device)` 取标量。改 discovery.py:318-320。

**验证者修正的修法**: backend/app/routers/discovery.py:320 — 把内联的 `{(await session.execute(select(Device))).scalars().all().__len__()}` 从 logger.info 的 f-string 中删除(仅去掉这个 total devices 计数即可,318-319 的 verify 查询是按主键 WHERE id=? 的单行查询,保留无害)。即改为:`logger.info(f"[APPROVE] Verify — device in DB: {db_device is not None}")`。若确需保留计数,可在文件顶部第 9 行 `from sqlalchemy import select` 改为 `from sqlalchemy import select, func`,再用 `(await session.execute(select(func.count()).select_from(Device))).scalar()` 取标量(避免 ORM 全表物化)。两种改法都只影响日志文本,不改变任何功能/API 行为。

**验证结论**: discovery.py:320 的 logger.info 确实内联执行 `select(Device)).scalars().all().__len__()`,把整张 devices 表全部 ORM 对象拉进内存仅为打印计数,是调试残留;删除该计数只影响日志文本、不改变任何功能,已完成的优化列表未覆盖此处。

## 32. [中] _deep_probe_and_update 后台任务无引用(可能被 GC)且静默吞异常

- **位置**: `backend/app/routers/discovery.py:186`
- **类别**: correctness | **区域**: routers | **是否改变行为**: 否

**证据**: 第 186 行 `asyncio.create_task(_deep_probe_and_update(dd.id, result['ip_address']))` 未保存返回的任务引用;asyncio 仅持弱引用,任务可能在执行中被垃圾回收,导致深度探测静默丢失。这正是拓扑模块已修复的问题(topology.py:262,270-272 用 `_discovery_tasks` 集合保引用 + done_callback)。另外 _deep_probe_and_update 第 101 行 `except Exception: pass` 把探测/写库的所有异常完全吞掉,无任何日志。

**建议修法**: 仿 topology.py 增加模块级 `_probe_tasks: set[asyncio.Task]` 保存引用并在 done_callback 中 discard(改 discovery.py:186);把第 101 行的裸 except 改为 `except Exception as e: logger.warning(f'deep probe {ip} failed: {e}')`。

**验证者修正的修法**: Original fix is correct; here is the exact form for discovery.py:
1) After line 45 (`_active_scans: dict[str, asyncio.Task] = {}`) add: `_probe_tasks: set[asyncio.Task] = set()`.
2) Replace discovery.py:186 with:
   `task = asyncio.create_task(_deep_probe_and_update(dd.id, result["ip_address"]))`
   `_probe_tasks.add(task)`
   `task.add_done_callback(_probe_tasks.discard)`
3) Replace discovery.py:101 (`    except Exception: pass`) with:
   `    except Exception as e:`
   `        logger.warning(f"deep probe {ip} failed: {e}")`
(logger is already imported at discovery.py:8, so no new import is needed.) This is logging-only plus a strong-reference registry, so it changes no observable behavior and needs no live device/DB to validate.

**验证结论**: discovery.py:186 creates a probe task with no saved reference (GC-able mid-run) and discovery.py:101 swallows all exceptions silently; the topology fix at topology.py:262,270-271 does not cover this file, and the suggested fix is logging-only plus a task registry, so it is behavior-safe.

## 33. [中] import_cisco_list 残留逐 OID N+1、O(n²) 去重与重复的优先级逻辑

- **位置**: `backend/app/routers/snmp_templates.py:222`
- **类别**: perf | **区域**: routers | **是否改变行为**: 否

**证据**: import_cisco_list(第 174-241 行):a) 第 222 行对每个 OID 执行 `select(ParsedOid).where(ParsedOid.oid == oid)` 查重(N+1);b) 第 218 行 `if oid and oid not in all_oids.values()` 在循环内对 dict.values() 做成员测试,整体 O(n²);c) 第 199-201 行仍内联复制了一份 `priority_keywords` 列表,与 mib_manager.CISCO_PRIORITY_KEYWORDS(第 41-45 行)重复——RE-2 只把常量+`_store_parsed_oid` 收敛到了 mib_manager,本文件未同步。

**建议修法**: 1) 复用 `from .mib_manager import CISCO_PRIORITY_KEYWORDS, _store_parsed_oid`(或把二者上移到 utils),删掉第 199-201 行内联常量;2) 用 `all_oids` 的 key 集合或反向集合做去重(第 218 行);3) 批量查重与 _store_parsed_oid 一致(第 222 行)。改 snmp_templates.py:199-224。注意第 204 行 `(priority_mibs+other_mibs)[:30]` 会静默只下前 30 个 MIB,与 mib_manager 全量下载不一致,建议确认是否为有意截断。

**验证者修正的修法**: 1) 常量复用:D:\Files\Code\NMS\backend\app\routers\snmp_templates.py:199-201 删除内联列表,改为顶部 `from .mib_manager import CISCO_PRIORITY_KEYWORDS`。已确认无循环导入(mib_manager.py:1-25 只 import ..database/..models/..utils,main.py:27 同时引入二者),且两列表字节一致,行为不变。
2) 去重 O(n²)→O(n):第 218 行不要用「key 集合」(all_oids 以 name 为 key,现有逻辑按 value(oid)去重;改成按 key 去重会改变语义、导致同名不同 OID / 同 OID 不同名的存储结果不同)。安全做法:在 :209 附近新增 `seen_oids: set[str] = set()`,把 :218 改为 `if oid and oid not in seen_oids:`,并在 :219 后 `seen_oids.add(oid)`,保持仍按 OID 去重。
3) N+1:不要复用 mib_manager._store_parsed_oid —— 它自身在 mib_manager.py:56 也是逐 OID 查询,无法消除 N+1。正确做法是整个循环结束后(或每批)批量查重,照抄 mib_manager.py:118-127 upload_mib 的模式:先累积 `candidates=[(name,oid,source)...]`,再 `select(ParsedOid.oid).where(ParsedOid.oid.in_([...]))` 得到 existing_set,仅对不在集合中的 oid 执行 session.add(ParsedOid(...))(描述仍用 oid_descriptions._lookup_oid_desc)。commit 仍只在 :235 执行一次,语义等价。
4) :204 的 `[:30]` 截断与 mib_manager.py:169 的全量下载不一致,但这是既有行为,除非确认有意,否则不要改动(改动会显著增加下载量与耗时)。

**验证结论**: snmp_templates.py:222 仍是逐 OID 查重(N+1),:218 仍对 all_oids.values() 做循环内成员测试(O(n²)),:199-201 仍内联复制的关键词(与 mib_manager.py:41-45 字节一致);RE-2 只改了 mib_manager.py,本文件未同步,故未修复;常量复用+反向集合+批量查重均可行为等价地修复,但原建议有两处陷阱需按 correctedFix 执行。

## 34. [中] mac_oui_to_vendor 每次调用都完整重读 nmap OUI 前缀文件,无缓存

- **位置**: `backend/app/services/scanner.py:173`
- **类别**: perf | **区域**: services | **是否改变行为**: 否

**证据**: L171-181:每次 mac 查询都对 '/usr/share/nmap/nmap-mac-prefixes' 和 '/usr/local/share/nmap/nmap-mac-prefixes' 逐行 open+读取,命中才 return,未命中则把整个文件(数万行)读完。该函数被扫描热路径反复调用:_read_arp_table 对每条 ARP 记录调用(L200/L210)、_get_arp_for_ip 各方法调用(L223/L231)、nmap_scan(L253/L260),即对每个被扫描 IP 都会触发一次或多次全文件扫描,是对 /24 及更大网段发现的主要 I/O 放大来源。

**建议修法**: 在 backend/app/services/scanner.py 模块级(如 L166 之后)加 `@lru_cache(maxsize=1)` 的一次性构建函数,把 prefix→vendor 载入 dict 后再查表;或直接改用 functools.lru_cache 装饰只读文件的内部加载函数,mac_oui_to_vendor 只做 dict 命中。

**验证者修正的修法**: In backend/app/services/scanner.py add `from functools import lru_cache` near the imports, and immediately after MAC_OUI_MAP (after L164) add:

    @lru_cache(maxsize=1)
    def _load_nmap_oui() -> dict[str, str]:
        table: dict[str, str] = {}
        for path in ["/usr/share/nmap/nmap-mac-prefixes", "/usr/local/share/nmap/nmap-mac-prefixes"]:
            try:
                with open(path) as f:
                    for line in f:
                        parts = line.split(None, 1)
                        if len(parts) == 2 and parts[1].strip():
                            table.setdefault(parts[0], parts[1].strip())
            except Exception:
                pass
        return table

Then replace L173-181 in mac_oui_to_vendor with:
    vendor = _load_nmap_oui().get(prefix6)
    if vendor:
        return vendor

Notes to preserve behavior: (1) `prefix6` is exactly 6 hex chars and nmap prefixes are exactly 6 chars, so `.get(prefix6)` is equivalent to the original `line.startswith(prefix6)`; (2) `setdefault` keeps the first-path-priority and first-match-within-file semantics of the original (file 1 wins over file 2); (3) the `except Exception` swallow is retained so a missing file still falls through to MAC_OUI_MAP. No test/DB/device changes needed; backend/tests/test_pure.py runs on Windows where both paths are absent and still passes.

**验证结论**: Confirmed at scanner.py:167-186 that mac_oui_to_vendor re-opens and fully scans the nmap OUI prefix files on every call with no caching, and it is invoked per-ARP-entry / per-IP across the scan hot path (L200/210/223/231, L256, discovery.py:370); an lru_cache'd dict loader is a faithful, behavior-preserving fix.

## 35. [中] _coerce 是死代码,且其数字判定与 int() 转换逻辑自相矛盾

- **位置**: `backend/app/services/snmp.py:53`
- **类别**: dead-code | **区域**: services | **是否改变行为**: 否

**证据**: L53-65 定义 `_coerce`,但全仓库除 L9 docstring 提及和 L53 定义外无任何调用(grep 仅命中 snmp.py:9/53 与 tests/test_snmp_service.py:49 的函数名)。同时其 L61-62 `if s.replace('-','').replace('.','').isdigit(): return int(s)` 对 '3.14' 判定为数字却执行 int('3.14') 抛 ValueError → 返回 None;L64-65 的兜底 except 把异常也变成静默 None。

**建议修法**: 删除 backend/app/services/snmp.py:53-65(含 L9 docstring 中 '返回值归一化由 _coerce 处理' 的说明),避免误导;归一化逻辑应只保留一份正确实现(见 L155 的问题)。

**验证者修正的修法**: 严格执行「只删不迁」:删除 backend/app/services/snmp.py:53-65 整个 `_coerce` 定义(含其 docstring 与 L64-65 的兜底 except),并删除/改写 L9 模块 docstring 中「返回值归一化由 _coerce 处理」这一句(建议改为「返回值归一化在各原语内联处理」)。注意:不要顺带「修正」L155 的内联判定(int(val) if str(val).replace("-","").replace(".","").isdigit() else val)——该行为(非整数浮点字符串如 "42.5" 因 int() 失败被静默跳过)已被 backend/tests/test_snmp_service.py:55-56 显式固定,改动会破坏测试并改变对外行为。

**验证结论**: 读过 snmp.py 全文并全仓库 grep `coerce`:L53-65 的 `_coerce` 确无任何调用(仅命中 L9 docstring、L53 定义与一个未调用它的测试函数名),且 L61-62 对 '3.14' 会走 int('3.14') 抛 ValueError 被 L64 兜底吞成 None,判定与实现自相矛盾;纯删除死代码不改变任何行为。

## 36. [中] snmp_get_many 数字归一化对小数会 int() 抛错并被静默丢弃,导致指标丢失

- **位置**: `backend/app/services/snmp.py:155`
- **类别**: correctness | **区域**: services | **是否改变行为**: 是

**证据**: L148-157 内联复刻了 _coerce 的逻辑:`result[name] = int(val) if str(val).replace('-','').replace('.','').isdigit() else val`。判定串先剥掉 '.' 再 isdigit(),于是 '3.14' 被判为数字,但随后 `int('3.14')` 抛 ValueError,被 L156 `except Exception: pass` 吞掉——该 OID 整个键既不写入 result 也无日志。任何十进制 SNMP 值(如 OctetString 承载的温度/电压/百分比)都会被静默丢弃。

**建议修法**: backend/app/services/snmp.py:155 改为先试浮点:`s = str(val); try: result[name] = int(s) if s.lstrip('+-').isdigit() else float(s) except ValueError: result[name] = val`,并在转换失败时记 logger.debug 而不是静默丢弃。

**验证者修正的修法**: If the loss is to be fixed deliberately, apply consistently and update the test. backend/app/services/snmp.py:149-157 replace the body with: `val = vb[1]` / `if hasattr(val, "_value"): val = val._value` / `if isinstance(val, bytes): val = val.decode("utf-8", errors="replace")` / `s = str(val).strip()` / `try:` / `    result[name] = int(s) if s.lstrip("+-").isdigit() else float(s)` / `except ValueError:` / `    result[name] = val`. Mirror the same logic in `_coerce` (snmp.py:60-63) if it is retained, and update backend/tests/test_snmp_service.py:55-56 to expect `res["c"] == 42.5` (that line currently asserts the old drop behavior).

**验证结论**: snmp.py:155 really does pass decimals through the isdigit guard and then throw inside int() (verified: str('3.14') -> isdigit True, int('3.14') -> ValueError), silently dropping the key via the L156 except; but the drop is deliberately asserted as legacy behavior at tests/test_snmp_service.py:55-56, so any fix changes behavior and breaks that test, making it not safely auto-applicable.

## 37. [中] CDP/LLDP 'walk' 只发一次 GETNEXT:重复 await 同一个 next_cmd 协程触发 RuntimeError 被静默吞掉

- **位置**: `backend/app/services/topology_discovery.py:117`
- **类别**: correctness | **区域**: services | **是否改变行为**: 是

**证据**: L106-113 在 while 循环**之前**创建 `iterator = next_cmd(...)` 一次,L115-131 的 while True 内反复 `await iterator`(L117)。已核对 pysnmp 7.1.29 源码(pysnmp/hlapi/v3arch/asyncio/cmdgen.py:316 `async def next_cmd(...)`,L453 `return await future`,**是协程而非异步生成器**),协程对象二次 await 会抛 RuntimeError('cannot reuse already awaited coroutine'),被 L130 `except Exception: break` 吞掉。因此每次 _discover_cdp/_discover_lldp 最多拿到 1 条邻居(单次 GETNEXT 只返回一行),拓扑发现严重降级。另外 L112/L147 传入的 `lexicographicMode=False` 不是 next_cmd 支持的选项(cmdgen 只识别 lookupMib/ignoreNonIncreasingOid),被静默忽略。

**建议修法**: 改用 `async for errorIndication, errorStatus, errorIndex, varBinds in walk_cmd(...)`(cmdgen.py:622,异步生成器,支持 lexicographicMode/maxRows),或在 while 循环内每轮用上一条 varBind 重新 `await next_cmd(...)`;同时去掉无效的 lexicographicMode 参数。文件 backend/app/services/topology_discovery.py:106-135 / 137-168。

**验证者修正的修法**: backend/app/services/topology_discovery.py:8-16 — replace the `next_cmd` import with `walk_cmd` (walk_cmd is exported from the same module; `next_cmd` is unused after the fix). Then rewrite the CDP block at L106-131 as an async-for over `walk_cmd`, keeping the same ObjectIdentity and adding a row bound:
```python
async for error_indication, error_status, error_index, var_binds in walk_cmd(
    SnmpEngine(),
    CommunityData(community, mpModel=1),
    await UdpTransportTarget.create((ip, 161), timeout=2, retries=1),
    ContextData(),
    ObjectType(ObjectIdentity("1.3.6.1.4.1.9.9.23.1.2.1.1.6")),  # cdpCacheDeviceId
    lexicographicMode=False,  # valid here; stops when OIDs leave this column subtree
    maxRows=256,              # bounds runaway walks
):
    if error_indication:
        break
    for vb in var_binds:
        neighbors.append({"neighbor_name": str(vb[1]), "local_interface": None, "neighbor_interface": None})
```
Apply the identical change to the LLDP block at L137-164 (OID 1.0.8802.1.1.2.1.4.1.1.9). `lexicographicMode=False` is only meaningful on `walk_cmd` (ignored on `next_cmd`), so moving it there also fixes the dead-option issue. Note this intentionally changes runtime results from <=1 neighbor per device to the full neighbor table, which is the function's intended behavior; the change is a mechanical, library-documented API swap requiring no DB and verifiable by unit-testing the neighbor list with a mocked walk_cmd.

**验证结论**: next_cmd in pysnmp 7.1.29 is a coroutine (cmdgen.py:316, `return await future`), so re-awaiting the single object created at L106/L141 throws RuntimeError on the 2nd loop iteration and is swallowed by `except Exception: break`, capping discovery at 1 neighbor per protocol; walk_cmd (cmdgen.py:622) is the correct async-generator API and supports the lexicographicMode that next_cmd silently ignores.

## 38. [中] _update_progress 从未被调用(死代码),其 folder_errors 统计因此永远为空

- **位置**: `backend/app/services/zabbix_repo.py:214`
- **类别**: dead-code | **区域**: services | **是否改变行为**: 否

**证据**: L214-222 定义 `_update_progress`,但全仓库 grep 只命中定义体本身(L215-222),没有任何调用点;进度更新全部由 _build_file_tree(L244-290)和 _do_refresh(L300-312)直接写 _scan_progress 字段完成。副效果:L221 维护的 `_scan_progress['folder_errors']` 永远不会被写入,任何读取该字段的前端/接口都拿不到失败文件夹信息。

**建议修法**: 删除 backend/app/services/zabbix_repo.py:214-222;若需要 folder_errors,则在 _build_file_tree 的根目录获取失败分支(L252-254)显式写入 _scan_progress['folder_errors']。

**验证者修正的修法**: 删除 backend/app/services/zabbix_repo.py 的 L212-L223(即 "# ── Progress ─" 分节注释 + L214-222 的 _update_progress 定义 + 前后空行)。全仓库无任何调用点、import、__all__ 导出或 getattr/globals() 动态引用,删除不会破坏任何功能。不要按原建议新增 folder_errors 写入:_build_file_tree 的失败分支(L252-254)保持原样即可,因为没有任何代码读取 folder_errors,新增写入只会产生无消费方的推测性行为。若确需记录根目录失败原因,应改为在 L252-254 分支内调用已有的 _add_log("error", ...)/(L253 已有),无需改动 _scan_progress 结构。

**验证结论**: 已读文件确认 _update_progress(L214-222)在全仓库仅存在定义、无调用/导入/动态引用,folder_errors 仅在该死函数内被写、无任何读取方,属真实死代码且删除安全。

## 39. [中] start_refresh 的后台任务未保留强引用,可能被 GC 中途回收

- **位置**: `backend/app/services/zabbix_repo.py:322`
- **类别**: state-mgmt | **区域**: services | **是否改变行为**: 否

**证据**: L322 `asyncio.create_task(_do_refresh())` 未保存返回值,模块级也没有 _refresh_task 之类变量(L28-33 只有 _cache/_scan_progress/_scan_logs)。事件循环对 Task 只持弱引用,未保存引用的任务可能在执行中途被垃圾回收(Python 官方 asyncio.create_task 文档明确警告)。同仓库的 topology 后台任务已经按正确做法保留引用:routers/topology.py:270-272 `task = asyncio.create_task(...); task.add_done_callback(_discovery_tasks.discard)`,说明这是遗漏而非有意。附带:L332-342 的 get_template_list(force_refresh=True) 在 `await start_refresh()` 后立即返回 `_cache['data']`,而刷新是异步的,首次调用必然返回 None→{}。

**建议修法**: backref backend/app/services/zabbix_repo.py:322,改为模块级保存 `_refresh_task = asyncio.create_task(_do_refresh())` 并 `_refresh_task.add_done_callback(...)` 清理(参照 routers/topology.py:270-272);如需要 await 刷新结果,start_refresh 应可返回可 await 的对象或让调用方轮询 get_scan_progress。

**验证者修正的修法**: 在 backend/app/services/zabbix_repo.py 模块级(约 L30,紧邻 `_scan_logs: list[dict] = []`)新增 `_refresh_task: asyncio.Task | None = None`;将 L316 的 `global _scan_progress` 改为 `global _scan_progress, _refresh_task`;把 L322 `asyncio.create_task(_do_refresh())` 改为:
```
_refresh_task = asyncio.create_task(_do_refresh())
_refresh_task.add_done_callback(_clear_refresh_task)
```
并新增 `def _clear_refresh_task(_t): global _refresh_task; _refresh_task = None`(参照 backend/app/routers/topology.py:270-272 的引用保留+done 回调清理写法)。行为完全不变,仅保证任务在执行期间有强引用。注意:不要动 L332-342 的 get_template_list 立即返回逻辑 —— routers/zabbix_templates.py:56-60 的文档说明 force 仅触发后台刷新、由前端轮询 /repo/status,首次返回 {} 属预期行为。

**验证结论**: 代码与描述完全一致(L322 丢弃 create_task 返回值、L28-33 无引用变量、L316 仅 global _scan_progress),正是 asyncio 文档明确警告的弱引用 GC 模式,且同仓库 topology.py:270-272 已用 add_done_callback 修正过同类问题;保存在模块级强引用是零行为变化的安全修复。

## 40. [中] alert_engine 零测试,且全局规则(device_id=NULL)会跨设备误解决未超阈告警

- **位置**: `backend/app/services/alert_engine.py:116`
- **类别**: correctness | **区域**: tests-eng | **是否改变行为**: 是

**证据**: tests/ 无任何 alert_engine 导入(仅纯函数/scanner/snmp/retention 被测)。逻辑上:models/alert.py:22-25 注明 `device_id ... NULL means global rule for all devices`;alert_engine.py:54-65 当 rule.device_id 为 NULL 时 metric_stmt 不带设备过滤,`order_by(collected_at.desc()).limit(1)` 只取全库最新一条;而 :116-119 else 分支解决告警时只按 `alert_rule_id` 过滤(无 device_id 条件),于是「某设备仍超阈值」的未解决告警,会被另一设备较新的正常值静默 resolved。与之不对称的是 :80-83 创建告警时按 `device_id == latest_metric.device_id` 去重——创建按设备、解决不按设备。

**建议修法**: alert_engine.py:116-119 的解决查询补 `Alert.device_id == latest_metric.device_id`;对全局规则(device_id 为空)应遍历所有设备各自取最新值分别评估,而非全库取一条。并补 `_evaluate_condition`(alert_engine.py:134)纯函数单测作为回归。

**验证者修正的修法**: 最小且安全的修法:在 backend/app/services/alert_engine.py:116-120 的解决查询中,补上一行条件 `Alert.device_id == latest_metric.device_id`(与第 79-85 行的创建去重条件对称),使解决仅作用于「当前取到最新值的那个设备」,从而阻止跨设备误解决。对 device_id 非空的规则,latest_metric.device_id 恒等于 rule.device_id,故无任何行为变化;仅对全局规则修正错误。注意:原建议中「全局规则遍历所有设备分别取最新值评估」是独立、更大的行为增强(会使全局规则按设备分别产生告警/解决),不应与本次修复捆绑,建议单列评估。另外可为 _evaluate_condition(alert_engine.py:130-142)补纯函数单测作为回归(可用现有 conftest 的 session fixture 构造两设备 metric/rule 场景验证解决范围)。

**验证结论**: 代码证实存在按设备创建、不按设备解决的逻辑不对称,且 alert_engine 无任何测试;补一行 device_id 过滤即可安全修复跨设备误解决,不改动其它既有行为。

## 41. [中] mypy 覆盖过窄:files 不含 routers/models 且 follow_imports=skip,大半代码从不做类型检查

- **位置**: `backend/pyproject.toml:38`
- **类别**: other | **区域**: tests-eng | **是否改变行为**: 否

**证据**: pyproject.toml:38 `follow_imports = "skip"`;:39-50 `files = ["app/utils/", "app/services/snmp.py", ..., "app/services/snmp_collector.py"]` 仅 9 项,不含 `app/routers/`(4802 行)与 `app/models/`(25 张表);且未开 `strict`/`disallow_untyped_defs`,默认宽松度。后果:doc 记录的 BUG-1(`MibFile` 未导入,devices.py)这类静态可查问题不会被发现;models 与 routers 的类型错误零拦截。

**建议修法**: 在 backend/pyproject.toml:39-50 的 files 增补 `"app/models/"` 与 `"app/routers/"`(可先按模块逐步 mypy 通过),并把 :38 的 follow_imports 从 skip 逐阶段改为 normal;若要更严可加 `[[tool.mypy.overrides]]` 分模块过渡而非全局 skip。

**验证者修正的修法**: 方向正确但勿一次性全量打开(会瞬间淹没在报错中)。更安全的分阶段落地,全部只改 backend/pyproject.toml:38-49:(1) 先在 :39-50 的 files 追加 "app/models/" 单独收敛——models 仅 809 行/25 表,错误最少最易修;(2) routers 不用改全局 follow_imports,改用按模块 override:`[[tool.mypy.overrides]]\nmodule = "app.routers.*"\nfollow_imports = "normal"`(mypy 支持 per-module 的 follow_imports),逐个 router 打开而非 4802 行一起上;(3) 若模型层因 untyped defs 报错过多,可加 `[[tool.mypy.overrides]]\nmodule = "app.models.*"\ndisallow_untyped_defs = false` 单点放松,避免全局改 strict。每步手工跑 `cd backend && mypy` 确认零新增报错后再合入(仓库无 CI/pre-commit 门禁,不会自动拦截)。

**验证结论**: pyproject.toml:38 follow_imports="skip" 且 :39-50 files 仅 9 项确实不含 app/routers/(4802 行)与 app/models/(25 表),无 strict/overrides;属纯静态检查配置,改动不触及运行时代码、无 CI 门禁,故安全可修,只是应分阶段而非一次性全开。

## 42. [中] ruff/mypy/pytest 三套配置已写好但无任何自动化入口,回归无防护

- **位置**: `backend/pyproject.toml:51`
- **类别**: other | **区域**: tests-eng | **是否改变行为**: 否

**证据**: 仓库无 CI、无 Makefile、无 pre-commit:`.github/workflows` 不存在,后端目录 `ls` 也无任何构建/校验脚本。pyproject.toml 的 [tool.ruff]、[tool.mypy]、[tool.pytest.ini_options] 三节配置齐备却无人执行,合入代码不会触发 lint/类型/测试,等价于「工具存在但未固化」。

**建议修法**: 新增 .github/workflows/ci.yml:actions/setup-python@v5 (python 3.11) → `pip install -r backend/requirements.txt -r backend/requirements-dev.txt` → 在 backend 目录跑 `ruff check .` / `mypy` / `pytest -q`,PR 与 push 触发。

**验证者修正的修法**: 原修法的 `pip install -r backend/requirements-dev.txt` 会失败:该文件不存在(仓库只有 backend/requirements.txt,且未固定 ruff/mypy/pytest/pytest-asyncio)。更安全的落地步骤:(1) 新建 `backend/requirements-dev.txt`,内容为 `ruff`、`mypy`、`pytest`、`pytest-asyncio`(asyncio_mode="auto" 依赖它);(2) 新建 `D:\Files\Code\NMS\.github\workflows\ci.yml`,触发器 `on: [push, pull_request]`,job 用 `actions/setup-python@v5`(python-version 3.11),`pip install -r backend/requirements.txt -r backend/requirements-dev.txt`,然后 `working-directory: backend` 依次执行 `ruff check .`、`mypy`(无参数,读取 pyproject 的 files 列表)、`pytest -q`。tests 全为 mock 纯逻辑(backend/tests/conftest.py 仅注入 sys.path),不需要 MySQL/真实设备;CI 文件是纯新增,不改动任何应用代码或运行时行为。若担心现有代码未通过导致首日红,可先本地跑一遍再合入,或对 mypy/ruff 暂用 `|| true` 放宽,但不必修改业务代码。

**验证结论**: pyproject.toml 确有 ruff/mypy/pytest 三节配置(行 2/33/51),而仓库无 .github、无 Makefile、无 pre-commit、无任何脚本调用它们,发现属实且未被"已完成优化"覆盖;新增 CI 文件为纯增量、测试为 mock 纯逻辑无需 DB/设备,安全可修,但原修法引用了不存在的 requirements-dev.txt,需先创建该文件。

## 43. [中] 开发/测试工具链依赖未声明:pytest-asyncio 缺失致 pyproject 的 asyncio_mode 配置无法复现

- **位置**: `backend/requirements.txt:13`
- **类别**: docs | **区域**: tests-eng | **是否改变行为**: 否

**证据**: requirements.txt 共 13 行仅运行时依赖,无 pytest / pytest-asyncio / ruff / mypy;仓库内也搜不到 pytest-asyncio 声明(仅 docs/OPTIMIZATION.md:115 计划建 requirements-dev.txt,但该文件不存在,`find` 全仓无 requirements-dev*)。而 pyproject.toml:53 声明 `asyncio_mode = "auto"` —— 这是 pytest-asyncio 专有 ini 选项。全新环境按 requirements.txt 安装后执行 pytest,会得到 `Unknown config option: asyncio_mode` 警告且 async 测试无法收集,声明的测试配置不可复现。

**建议修法**: 新增 backend/requirements-dev.txt,写入 `pytest>=8`、`pytest-asyncio>=0.23`、`ruff`、`mypy`(即 doc ENG-1.1 计划的落地);rn并在 README/docs 注明安装命令 `pip install -r requirements.txt -r requirements-dev.txt`。

**验证者修正的修法**: Add backend/requirements-dev.txt with: pytest>=8, pytest-asyncio>=0.23, ruff>=0.5, mypy>=1.10. Do NOT frame it as fixing test collection — backend/tests/ has no async test functions (grep 'async def test_' = 0); every test is sync and calls asyncio.run(), so asyncio_mode='auto' (backend/pyproject.toml:53) is currently inert and emits only a PytestConfigWarning when pytest-asyncio is absent. Adding pytest-asyncio is still correct (future-proofs async tests) and is behavior-neutral for the existing sync suite. Alternatively, if async tests aren't planned, delete backend/pyproject.toml:53 as an equally valid minimal fix. Optionally update README.md:150 to `pip install -r backend/requirements.txt -r backend/requirements-dev.txt` (note: current README:150 uses a bare requirements.txt path).

**验证结论**: Dev/test deps are genuinely undeclared (requirements.txt 1-13 runtime-only; no requirements-dev.txt anywhere; pytest-asyncio only named in docs/OPTIMIZATION.md:115), but the stated consequence is overstated: there are 0 async test functions (all 26 tests are sync and use asyncio.run), so the missing pytest-asyncio only yields a PytestConfigWarning, not uncollected tests; the real impact is that pytest itself can't run from a fresh env.

## 44. [低] api.js 有 24 个方法在 frontend 内零调用(约 170 行死代码)

- **位置**: `frontend/js/api.js:265`
- **类别**: dead-code | **区域**: frontend-core | **是否改变行为**: 否

**证据**: 对 `API.<name>(` 做全量搜索,以下方法命中 0 次:getFrontPanels(265)、createFrontPanel(270)、updateFrontPanel(275)、deleteFrontPanel(280)、addFrontPanelPort(290)、updateFrontPanelPort(295)、deleteFrontPanelPort(300)、getInterfaceMetrics(174)、moveDeviceInRack(253)、updateAlertRule(317)、getDevices 之外的 getVendors(354)、getDashboards(460)、createDashboard(465)、getDashboardWidgets(470)、createDashboardWidget(475)、updateDashboardWidget(480)、deleteDashboardWidget(485)、getDashboardData(490)、getTemplateItems(376)、addTemplateItem(381)、deleteTemplateItem(386)、deleteTemplate(371)、applyTemplate(391)、getZabbixTemplateContent(413)。同类死代码另有:format.js:17 bytes()、format.js:100 uptime()(其唯一内部调用 duration() 也仅在 uptime 内被用)、format.js:89 duration() 全项目 0 调用;constants.js:24 CHART_COLORS、39 SEVERITY_COLORS、46 IF_TYPES 0 引用;components/ui.js:8 esc、11 spinner()、16 emptyState() 0 引用(仅 confirmDelete 被 alerts.js:194 用一次);context-menu.js:62 hide() 0 调用。

**建议修法**: 分批删除上述零引用成员;若确为面向未来/外部调用的公共客户端,则加注释标注并保留。删除后用后端 pytest 与前端手工回归验证。

**验证者修正的修法**: 删除时按块操作，注意两点：(1) frontend/js/api.js 的 Front Panels 区块**只删下面这些，务必保留 getFrontPanelPorts（284-287，被 components/front-panel.js:19,37 调用）**：getInterfaceMetrics(174-176)、moveDeviceInRack(252-255)、getFrontPanels(264-267)、createFrontPanel(269-272)、updateFrontPanel(274-277)、deleteFrontPanel(279-282)、addFrontPanelPort(289-292)、updateFrontPanelPort(294-297)、deleteFrontPanelPort(299-302)、updateAlertRule(316-319)、getVendors(353-356)、deleteTemplate(370-373)、getTemplateItems(375-378)、addTemplateItem(380-383)、deleteTemplateItem(385-388)、applyTemplate(390-393)、getZabbixTemplateContent(412-415)、Dashboards 区块 getDashboards/createDashboard/getDashboardWidgets/createDashboardWidget/updateDashboardWidget/deleteDashboardWidget/getDashboardData(459-492)。(2) frontend/js/utils/format.js 中 duration(88-95) 是 uptime(99-104) 的唯一内部调用者——必须把 uptime 与 duration **一起删**，否则留下悬空引用；bytes(16-25) 可单独删。另：constants.js 删 CHART_COLORS(23-28)/SEVERITY_COLORS(38-43)/IF_TYPES(45-53)；ui.js 删 esc(7-8)/spinner(10-13)/emptyState(15-22)（保留 24-27 的 confirmDelete）；context-menu.js 删 hide(59-65)。

**验证结论**: 逐文件 grep 证实这 24 个 API 方法及其余成员在前端（含 index.html）确为 0 调用，且无动态分发/导出，属真实死代码；删除零引用成员不改变行为，但须保留 getFrontPanelPorts 并将 uptime 与 duration 一起删。

## 45. [低] localStorage 全局状态散落在 8 个文件、18 个键,无集中封装

- **位置**: `frontend/js/i18n.js:5`
- **类别**: architecture | **区域**: frontend-core | **是否改变行为**: 否

**证据**: 直读键: i18n.js:5/340(nms_lang)、i18n.js:397(nms_device_types);dashboard.js:82/90(nms_dashboard_widgets);device-models.js:9/10/11/216/227(nms_vendor_overrides、nms_deleted_vendors);device-types.js:5/6(被用于 nms_type_overrides、nms_deleted_types、nms_cats_overrides、nms_cats_added、nms_device_types、nms_deleted_cats 共 6 键);devices.js:414/437 与 mib-manager.js:428/436(nms_modal_pct);discovery.js:136 与 settings-page.js:44/61(scan_concurrency,唯一无 nms_ 前缀的键);mib-manager.js:496/501/509-511/529-531(nms_oid_col_widths、nms_snmp_test_cfg、nms_test_concurrency、nms_test_retries);另有 sessionStorage zabbix-templates.js:651(openTemplateId)。键名前缀与序列化格式不统一,多处各自 try/catch JSON.parse,易发生键名漂移(如 nms_test_concurrency 同时被 settings-page.js:62 与 mib-manager.js:530 写)。

**建议修法**: 新增 frontend/js/utils/storage.js,提供 Storage.get/getJSON/set/setJSON 与集中键名常量(统一 nms_ 前缀);各页面改为调用它,并在 index.html:141(utils/table-resize.js)之后引入该脚本。

**验证者修正的修法**: 1) Insert frontend/js/utils/storage.js BEFORE i18n.js — i.e. add `<script src="/static/js/utils/storage.js?v=...">` at frontend/index.html:136 (not after line 141), because i18n.js:5 evaluates `localStorage.getItem('nms_lang')` at script-load time and would hit `Storage is undefined` otherwise. 2) In storage.js keep the EXACT existing key literals — do NOT unify the prefix; keep `scan_concurrency` (discovery.js:136, settings-page.js:44/61) as-is, otherwise existing users silently lose the setting and fall back to default 50/10. 3) Provide two APIs matching the two current forms: raw-string (Storage.getRaw/setRaw) for nms_lang (i18n.js:5/340), scan_concurrency, nms_modal_pct (devices.js:414/437, mib-manager.js:428/436), nms_test_concurrency, nms_test_retries; and JSON (Storage.getJSON/setJSON with try/catch default) for the rest (nms_device_types, nms_dashboard_widgets, nms_vendor_overrides, nms_deleted_vendors, nms_type_overrides, nms_deleted_types, nms_cats_overrides, nms_cats_added, nms_deleted_cats, nms_oid_col_widths, nms_snmp_test_cfg). 4) Note counts: 16 localStorage keys in 8 files + 1 sessionStorage key (openTemplateId, zabbix-templates.js:651; sessionStorage needs a separate Storage.session API), not 18. 5) device-types.js:5/6 already has a page-local _get/_set wrapper — migrate it to the shared util rather than adding a second copy.

**验证结论**: Scattered localStorage (8 files, ~16 keys, no storage.js wrapper) is real and every cited file:line checks out, but the proposed fix as written breaks boot (storage.js inserted at index.html:141, after i18n.js:137 which reads storage at load time) and renames scan_concurrency (losing saved settings).

## 46. [低] 右键菜单标签硬编码英文,i18n 字典里对应键(rename/change_icon/…)从未被使用

- **位置**: `frontend/js/utils/constants.js:87`
- **类别**: duplication | **区域**: frontend-core | **是否改变行为**: 否

**证据**: constants.js:88-126 的 CONTEXT_MENUS 各菜单 label 全为英文硬编码('Rename'/'Change Icon'/'Edit Details'/'Remove from Map'/'SSH Connect'/'RDP Connect'/'Web Interface'/'View Dashboard'/'Edit Label'/'Line Style'/'Port Names'/'Solid'/'Dashed'/'Dotted'/'Arrow'/'Copy' 等),context-menu.js:29 直接渲染 `item.label`。i18n.js:91-98 已存在对应中文键 rename:'重命名'、change_icon:'更换图标和颜色'、edit_details、remove_from_map、ssh_connect、rdp_connect、web_interface、view_dashboard、edit_label、line_style、port_names、solid、dashed、dotted、arrow、show_arrow、copy、delete_confirm 等,但 T() 使用列表里完全没有这些键。context-menu.js:204/217/234/310 的 confirm/prompt/Modal 也硬编码英文,尽管字典有 delete_node_confirm/delete_edge_confirm/name_updated/node_deleted/edge_deleted/copied 等键。

**建议修法**: 把 constants.js 的 label 换成 i18n 键、context-menu.js:29 渲染 `${T(item.label)}`;或直接把 context-menu.js 内文本改用 T('...')。

**验证者修正的修法**: constants.js:88-126 把各 label 改为 i18n 键(如 label:'rename'、'change_icon'…),context-menu.js:29 改为 `${T(item.label)}`。重要:rack_device 的 'Remove from Rack'(constants.js:119)在 i18n 中无对应键(全仓 grep 无 remove_from_rack),须先在 i18n.js 的 zh 区(约 line 92 附近)与 en 区(约 line 250 附近)各新增 remove_from_rack:'从机柜移除'/'Remove from Rack',否则 T() 回退返回键名(i18n.js:333),该菜单项会显示 "remove_from_rack"。其余 label 均有现成键(rename/change_icon/edit_details/remove_from_map/ssh_connect/rdp_connect/web_interface/view_dashboard/edit/delete/edit_label/line_style/port_names/copy/edit_device)。可选:顺带把 context-menu.js 内的英文提示改用已有键——106行 prompt('New name:')→edit_node_label 语义/110行 'Name updated'→name_updated、204行 confirm→delete_node_confirm、207行 'Node deleted'→node_deleted、265/301行 'Style updated'/'Port names saved'(无键)、310行 'Copied to clipboard'→copied、316行 confirm→delete_edge_confirm、320行 'Edge deleted'→edge_deleted。CONTEXT_MENUS[].label 仅被 context-menu.js:29 渲染,无其他消费者,改动不影响逻辑。

**验证结论**: 读代码确认 constants.js:88-126 标签全为硬编码英文、context-menu.js:29 直接渲染 item.label,而 i18n.js:91-113 的对应键经 grep 确认从未被 T()/data-i18n 使用,属真实的 i18n 键死代码/文案重复;修复为纯前端文案改动可静态验证,但原建议漏了 rack_device 的 'Remove from Rack' 缺少 remove_from_rack 键,需补键方可避免显示原始键名。

## 47. [低] 一批已定义但从未调用的方法(死代码),含一个引用不存在元素的方法

- **位置**: `frontend/js/pages/devices.js:448`
- **类别**: dead-code | **区域**: frontend-pages | **是否改变行为**: 否

**证据**: grep 全前端确认仅定义处命中:devices.js:113 `viewDevice()`;devices.js:448 `_onUnitChange()`(内部读 `document.getElementById('liveUnitSel')`,该 id 全仓库不存在,只此一处);devices.js:544 `_toggleWalk()`(注释自述 "Legacy - use _toggleWalkGroup");discovery.js:537 `_initColumnResize()`(已被 utils/table-resize.js 的 TableResize 取代);mib-manager.js:491 `_saveColWidths()` 与 499 `_restoreColWidths()`;mib-manager.js:702 `_testOid()`(与 543 行 _doTestOne 逻辑重复,_testOidRow 实际调的是 _doTestOne);add-device.js:188 `_seedModels()`。

**建议修法**: 删除 devices.js:113-115、448-463、544-547;discovery.js:537-560;mib-manager.js:491-506、702-759;add-device.js:188-194。均无外部 onclick/引用,删除不影响行为。

**验证结论**: All 7 methods (devices.js:113/448/544, discovery.js:537, mib-manager.js:491/702, add-device.js:188) are defined but referenced nowhere in frontend/ (grep hits only definitions); the cited line ranges match exactly and deletion is behavior-neutral.

## 48. [低] JSON 数组字段被注解为 Mapped[str | None],与列类型/实际语义不符

- **位置**: `backend/app/models/device_template.py:73`
- **类别**: architecture | **区域**: models-utils | **是否改变行为**: 否

**证据**: device_template.py:73-80:`mib_file_ids: Mapped[str | None] = mapped_column(JSON, ...)` 与 `cisco_list_ids: Mapped[str | None] = mapped_column(JSON, ...)`,列是 JSON、注释为 “JSON array of …”,实际赋值确是 list:routers/snmp_templates.py:281-292 用 `mib_file_ids: list[str]` 直接赋给 `t.mib_file_ids`,`_resolve_json_ids` 按列表读取。注解 `str` 会让 mypy/IDE 误判(正确应为 `Mapped[list | None]`)。同类问题:models/device.py:83 `tags: Mapped[dict | None]` 但注释写 “Tags as JSON array”。

**建议修法**: 把 device_template.py:73、77 的注解改为 `Mapped[list[str] | None]`(或 `Mapped[list | None]`),device.py:83 的 `tags` 视前端实际写入值统一为 `Mapped[list | None]` 或修正注释。仅类型注解,运行时无变化。

**验证者修正的修法**: device_template.py 部分照原建议改即可：把 backend/app/models/device_template.py:73 的 `mib_file_ids: Mapped[str | None]` 和 :77 的 `cisco_list_ids: Mapped[str | None]` 改为 `Mapped[list[str] | None]`(列类型已显式声明为 JSON,runtime 无变化;全部读取都经 _resolve_json_ids,无 str 用法)。但对 device.py:83 **不要**改成 list —— 该字段的 API schema 也是 dict(routers/devices.py:164 `tags: dict | None = None`),且无任何代码写入 list,改成 list 反而错误;只需把注释 `# Tags as JSON array` 改为 `# Tags as JSON object`,或保持 `Mapped[dict | None]` 不动。

**验证结论**: device_template.py:73/77 确为 JSON 数组列却注解为 `Mapped[str | None]`,而 snmp_templates.py:291-292 直接赋 list、_resolve_json_ids 按 list 读取,类型注解确实不符且仅改注解可安全修正;device.py:83 的 `tags` 实际是 dict,schema 与用法均为 dict,只应改注释而非改成 list。

## 49. [低] snmp_helpers 多个常量与 mib_parser.parse_mib_file 从未被引用

- **位置**: `backend/app/utils/snmp_helpers.py:83`
- **类别**: dead-code | **区域**: models-utils | **是否改变行为**: 否

**证据**: 全仓 grep(排除定义处)确认零引用:snmp_helpers.py:83 `SNMP_OID_VENDOR`、:111 `IF_TYPE_MAP`、:37 `SNMP_OID_DISK`、:69 `SNMP_OID_CDP`、:75 `SNMP_OID_LLDP`;以及 mib_parser.py:5 `parse_mib_file`(定义后无任何调用;snmp_templates.py:22 只导入 download_and_parse_mib/parse_cisco_supportlist/parse_mib_oids)。对照 SNMP_OID_SYSTEM/INTERFACES(snmp.py 使用)、SNMP_OID_CPU/MEMORY(snmp_collector 使用)确实在用。

**建议修法**: 删除 snmp_helpers.py:37-44(SNMP_OID_DISK)、:69-80(SNMP_OID_CDP/SNMP_OID_LLDP)、:83-86(SNMP_OID_VENDOR)、:111-116(IF_TYPE_MAP),以及 mib_parser.py:5-44(parse_mib_file)。删除前用一次全仓 `grep -rw` 复核(含 scripts/native 目录)以防外部脚本按名引用。

**验证结论**: Repo-wide grep confirms SNMP_OID_DISK(37-44)/SNMP_OID_CDP(69-73)/SNMP_OID_LLDP(75-80)/SNMP_OID_VENDOR(83-86)/IF_TYPE_MAP(111-116) in snmp_helpers.py and parse_mib_file(mib_parser.py:5-44) have zero references (no wildcard imports, no __init__ re-exports), so deleting them changes no behavior; not covered by prior optimizations.

## 50. [低] README/NATIVE_DEPLOYMENT 与实际仓库多处不符（表数量、目录结构、凭据文件名）

- **位置**: `README.md:317`
- **类别**: docs | **区域**: native-deploy | **是否改变行为**: 否

**证据**: README.md:317 称 “uses 12 core tables”，但紧随的表列了 13 行，实际 ORM 定义 25 张表（grep __tablename__），且缺 device_models/monitoring_templates/template_items/parsed_oids/mib_files/oid_test_results/ai_settings/dashboards/dashboard_widgets/web_scraper_configs/device_ports/device_protocol_data；README.md:346 再次写 “ORM models (12 tables)”。README.md:362-363 把 `docker-compose.yml`、`Dockerfile` 列为项目根文件，但 `ls` 确认二者不存在。README.md:347 “routers (8 modules)” 实为 13 个 router 模块；README.md:359 “pages (7 pages)” 实为 14 个；README.md:360 “components (5)” 实为 4 个（context-menu/front-panel/rack-view/ui）。NATIVE_DEPLOYMENT.md:626 目录结构写 `credentials.txt`，而 nms.sh:521-529 与 nms.ps1:326-334 实际生成的是 `.credentials`。

**建议修法**: 更新 README.md:317/335/346/347/359/360/362-363 与 native/NATIVE_DEPLOYMENT.md:626 的计数与文件名；表清单建议改为指向 backend/app/models/ 而非硬编码，避免再次漂移。

**验证者修正的修法**: Docs-only, no runtime risk. Concrete edits: README.md:317 change "uses 12 core tables" to "uses 25 core tables" and make the table list all 25 __tablename__ values (add device_models, monitoring_templates, template_items, parsed_oids, mib_files, oid_test_results, ai_settings, dashboards, dashboard_widgets, web_scraper_configs, device_ports, device_protocol_data) or replace with "see backend/app/models/"; README.md:346 change "(12 tables)" -> "(25 tables)"; README.md:347 "(8 modules)" -> "(13 modules)"; README.md:359 "(7 pages)" -> "(14 pages)"; README.md:360 "(5)" -> "(4)"; README.md:362-363 delete the docker-compose.yml and Dockerfile lines (files do not exist); native/NATIVE_DEPLOYMENT.md:626 change `credentials.txt` -> `.credentials` (match nms.sh:521 / nms.ps1:333). Keep css "(5 files)" at README.md:354 as-is (it is correct).

**验证结论**: All cited mismatches reproduce in the current tree (README says 12 tables but lists 13 rows and the ORM defines 25; docker files absent; credentials.txt vs .credentials), and it is a pure-documentation fix with no behavioral impact.

## 51. [低] get_dashboard 访问懒加载 dashboard.widgets(文档称已修但代码未修)

- **位置**: `backend/app/routers/dashboards.py:164`
- **类别**: correctness | **区域**: routers | **是否改变行为**: 否

**证据**: get_dashboard(第 140-174 行)用普通 `select(Dashboard).where(...)`(第 146-148 行,无 options(selectinload)),却在第 164 行 `for w in (dashboard.widgets or [])` 访问关系。Dashboard.widgets 为默认懒加载(models/dashboard.py:23-25)。docs/OPTIMIZATION.md 第 50 行明确写着“修复 get_dashboard / get_dashboard_data 访问 dashboard.widgets 的 async lazy-load MissingGreenlet bug(补 selectinload)”,但当前代码里 list_dashboards(第 61 行)、get_dashboard_data(第 319 行)确有 selectinload,唯 get_dashboard 没有——修复未落到该端点(git 中该端点自初始提交起就无 selectinload)。前端目前只调 /dashboards/{id}/widgets 与 /data,故未被触发,但接口调用即 500。

**建议修法**: 在 dashboards.py:146-148 的 select 上加 `.options(selectinload(Dashboard.widgets))`,与同文件其余两处保持一致。

**验证结论**: Confirmed: dashboards.py:146-148 loads Dashboard without selectinload yet line 164 reads dashboard.widgets (default lazy relationship), so GET /dashboards/{id} raises MissingGreenlet; sibling endpoints line 61/319 already use selectinload, and the doc at OPTIMIZATION.md:50 overclaims the fix. Adding selectinload matches the existing pattern and cannot break behavior.

## 52. [低] create_all 与 Alembic 基线并存,两个 schema 来源且无一致性校验

- **位置**: `backend/app/database.py:43`
- **类别**: architecture | **区域**: tests-eng | **是否改变行为**: 否

**证据**: database.py:43 `init_db()` 仍执行 `await conn.run_sync(Base.metadata.create_all)`,且被 app/main.py lifespan 在启动时调用(`await init_db()`);同时 backend/alembic/versions/fb2e278a066a_baseline_schema.py 已用 25 个 `op.create_table` 定义同一批表(与 models 的 25 个 `__tablename__` 对应)。两套来源无任何测试断言其一致:开发环境靠 create_all 建表、生产靠 alembic,新增/改列若未生成迁移,生产会静默缺列。

**建议修法**: 将 init_db 的 create_all 收敛为仅 DEBUG 开发路径(如 `if settings.DEBUG: create_all`),生产改为 `alembic upgrade head`;并在 CI 加一步一致性校验(空 SQLite 跑 `alembic upgrade head` 后与 `Base.metadata` 表/列 diff,或 `alembic check`)。

**验证者修正的修法**: Do NOT gate create_all behind DEBUG. Keep backend/app/database.py:43 and app/main.py:48 runtime behavior unchanged (create_all is the only table-creation path in the repo; nothing runs `alembic upgrade head` at startup and no deploy script invokes it, so gating on DEBUG=false would leave non-DEBUG deployments with no tables). Instead add a purely additive, opt-in consistency test, e.g. backend/tests/test_migration_consistency.py that: (1) points alembic at an empty SQLite via ALEMBIC_DATABASE_URL=sqlite:///./_tmp.db (alembic/env.py:29-32 already honors this env var), (2) runs `alembic upgrade head` programmatically against a temp DB, and (3) compares Base.metadata to the migrated schema using alembic.autogenerate.compare_metadata / `alembic check`. This adds the missing consistency assertion without changing startup behavior and without requiring MySQL. A DEBUG gate could be added later only once a deploy path actually runs alembic.

**验证结论**: Facts verified (database.py:43 create_all, main.py:48 init_db at startup, 25-table alembic baseline matching 25 model tablenames, no consistency test), and the issue is not in the completed-optimization list; however the proposed `if settings.DEBUG: create_all` gate is a behavior change — create_all is the sole creation path and DEBUG defaults false (config.py:18) with no alembic-on-startup anywhere — so it is unsafe to apply as written; the safe version is an additive migration-vs-metadata consistency test only.

## 53. [低] 高风险的采集/拓扑/Zabbix 服务完全未测(snmp_collector/topology_discovery/zabbix_repo/icmp_monitor)

- **位置**: `backend/tests/test_pure.py:1`
- **类别**: test-gap | **区域**: tests-eng | **是否改变行为**: 否

**证据**: tests/ 中 `zabbix_repo|alert_engine|icmp_monitor|snmp_collector|topology_discovery` 的导入数为 0(grep 全 tests 返回 NONE)。这些模块规模不小且承担核心行为:snmp_collector.py 215 行、topology_discovery.py 238 行、zabbix_repo.py 360 行、icmp_monitor.py 131 行;其中 zabbix_repo.py:38 `_is_yaml`、:46 `_is_junk_file`、`:21 CACHE_TTL` 判定均为纯函数,doc ENG-1.3 已把它们列为应测目标却未落地。

**建议修法**: 在 backend/tests/ 补 test_zabbix_repo.py(测 `_is_yaml`/`_is_junk_file`/缓存 TTL 逻辑),以及针对 snmp_collector 指标聚合、topology_discovery 端口解析的纯逻辑分片测试(把可测的纯函数抽离后再测)。

**验证者修正的修法**: 只落地可安全执行的子集:新增 backend/tests/test_zabbix_repo.py,纯离线、无需 DB/设备——断言 _is_yaml 对 'a.yaml'/'a.yml' 为真、'a.md' 为假(zabbix_repo.py:38);_is_junk_file 对 'README.md'/'x.png' 为真、't.yaml' 为假(zabbix_repo.py:46-52);并用 monkeypatch 改写模块级 _cache 后断言 get_cache_info() 的 cache_ttl_seconds == CACHE_TTL(zabbix_repo.py:354-360)。不要把 snmp_collector/topology_discovery/icmp_monitor 纳入本次改动:其行为与 async_session 写入/SNMP/网络强耦合(snmp_collector.py:142-176、icmp_monitor.py:105-131),需真实设备/数据库才能验证;且 snmp_collector 的指标类型/单位推断是内联逻辑(snmp_collector.py:146-147),要先做生产代码抽离(重构)才能单测。另 topology_discovery.py 并不存在『端口解析』纯逻辑,local_interface/neighbor_interface 恒为 None(topology_discovery.py:123-127、156-160),原建议该分片描述有误,应删除。

**验证结论**: 覆盖缺口属实(grep 证实 4 模块在 tests/ 零引用,行数吻合,且 docs/OPTIMIZATION.md:151 已将 zabbix_repo 纯函数列为未落地的 ENG-1.3 目标),但建议修法整体不可安全执行——snmp_collector/icmp_monitor/topology 目标逻辑需真实 DB/SNMP 验证且需重构抽函数,仅 zabbix_repo 纯函数测试可安全新增。

---

# 查漏补缺(评审补充的 5 项)

## G1. [高] 接口采集(FEAT-2)从未落库:DeviceInterface/InterfaceMetric 全库无任何写入方,前端接口列表永远是空

- **位置**: `backend/app/services/snmp_collector.py:174`
- **证据**: grep 全 backend 只有 `class DeviceInterface(Base)`(backend/app/models/metrics.py:40)与 `class InterfaceMetric(Base)`(metrics.py:66)两处定义,无任何 `DeviceInterface(`/`InterfaceMetric(` 构造,也无 `.add(`。唯一的接口发现函数 backend/app/routers/devices.py:68 `_discover_interfaces` 只 walk 出 {index:name} 映射供 LLD 使用(调用点 devices.py:550),从不写 DeviceInterface;snmp_collector.py:164-174 用 hardcode `1.3.6.1.2.1.2.2.1.10.1`(仅第一个接口)写成 DeviceMetric(metric_type="network"),并在 174 行注释 `# Skip interfaces — focus on CPU/memory metrics`。但读取端大量存在:backend/app/routers/devices.py:669 `GET /{device_id}/interfaces` 查 DeviceInterface、backend/app/routers/metrics.py:74 查 InterfaceMetric、backend/app/routers/front_panels.py:154-157 靠它给端口状态。前端因此恒为空:frontend/js/pages/device-detail.js:353-355 永远显示 'No interfaces found',frontend/js/pages/devices.js:132-134 快速视图永远 '0/0 UP'。相关地,topology.js:206/1458 依赖的 `device.interfaces_count` 后端从未返回,永远走 `|| 24` 兜底。
- **建议修法**: 在 backend/app/services/snmp_collector.py:164-174 处,把 if_in/out_octets(及 ifOperStatus/ifDescr/ifSpeed)的 walk 结果 upsert 到 DeviceInterface(models/metrics.py:40)与 InterfaceMetric(models/metrics.py:66),按 if_index(去掉最后一段索引)关联;或若确定不做该功能,则删除这两个模型 + devices.py:669 与 metrics.py:65 端点,避免留下永久空的 API 契约。

## G2. [中] analyze_mib 的 N 个并发 AI worker 共用同一个请求级 AsyncSession(非并发安全),失败被逐批吞掉并跳过

- **位置**: `backend/app/routers/mib_manager.py:580`
- **证据**: backend/app/routers/mib_manager.py:464 `async def analyze_mib(file_id, session=Depends(get_session))`,其内部 `stream_progress()` 以 `concurrency = ai_config.ai_concurrency or 3`(mib_manager.py:514)启动 `worker_tasks = [asyncio.ensure_future(worker_wrapper(i+1)) for i in range(concurrency)]`(mib_manager.py:613);每个 `worker()`(mib_manager.py:530)在循环里直接 `await session.execute(text("INSERT INTO parsed_oids ..."))`(mib_manager.py:580)并 `await session.commit()`——用的是同一个闭包 session。代码自身已暴露该隐患:`session.autoflush = False`(mib_manager.py:572)以及失败后 `await session.rollback(); await session.begin()`(mib_manager.py:594-595,注释'重新开始事务,避免后续操作失败')。SQLAlchemy AsyncSession 不允许并发复用,多 worker 同时 execute 会触发 'This session is provisioning a new connection' 类 InvalidRequestError,被 mib_manager.py:600 的裸 `except Exception` 捕获后仅 yield 一条 ` #N` 日志并 `continue`,导致整批 OID 被静默跳过(分析数减少、无重试)。
- **建议修法**: 在 backend/app/routers/mib_manager.py:530 的 worker 内部改用独立会话:`async with async_session_factory() as wsession:` 执行 580 行的 INSERT 与 592 行 commit(需从 ..database import async_session_factory),并去掉 572/594-595 针对共享 session 的 autoflush/rollback hacks;请求级 session 仅用于 466/470 的前置读取。

## G3. [中] web_scraper 整个子系统为孤儿死代码:3 个模型无 router/无 service/无写入方,retention 还在清理永不写入的表

- **位置**: `backend/app/models/web_scraper.py:42`
- **证据**: backend/app/models/web_scraper.py 定义了 WebScraperConfig(:20)、DevicePort(:42)、DeviceProtocolData(:72);仅在 backend/app/models/__init__.py:10 导入并在 :21-23 导出。全仓库 grep `WebScraperConfig|DevicePort|DeviceProtocolData|web_scraper` 在 routers/services/main.py 中零命中(main.py:16-30 的 router 清单里没有 web_scraper 路由),也没有任何构造/写入。Alembic 基线 backend/alembic/versions/fb2e278a066a_baseline_schema.py:322 仍为其建表。更矛盾的是 backend/app/services/retention.py:25 把 `("device_protocol_data", "collected_at")` 列入清理清单,而该表永远没有数据——清理逻辑对着空表空跑。
- **建议修法**: 二选一:(a) 确认该功能已废弃 → 删除 backend/app/models/web_scraper.py、models/__init__.py:10/21-23 的导出、retention.py:25 的 device_protocol_data 条目,并补一条 Alembic drop_table 迁移;(b) 若仍计划做 → 明确标注 TODO 并停用 retention 条目,避免误导。

## G4. [中] 拓扑自动布局用『全表加载 + 行数』推导坐标:每建一个节点先 select 整张 topology_nodes,且删节点后新节点坐标必然重叠

- **位置**: `backend/app/services/topology_discovery.py:82`
- **证据**: backend/app/services/topology_discovery.py:82-87: `count_result = await self.session.execute(select(TopologyNode))` 后 `count = len(count_result.scalars().all())`,再 `col = count % 5; row = count // 5`。即为了一个计数把整张 topology_nodes 全量拉进内存(节点越多越慢,且随每次 _discover_device → _get_or_create_node 触发)。同样的行数布局在前端 frontend/js/pages/topology.js:160-166 也复制了一份。因坐标由『当前总节点数』决定,一旦用户删除任意节点,count 回退,下一个自动节点就会落在已存在节点的 (x,y) 上,造成节点重叠。
- **建议修法**: backend/app/services/topology_discovery.py:82-85 改用 `select(func.count()).select_from(TopologyNode)`(import func),并改为取 max(x)/max(y) 或扫描空位来定位,而非用行数取模;前端 topology.js:160-166 若需保留兜底布局也应同样基于已有最大坐标而非数组长度。

## G5. [中] CDP/LLDP 端口解析(FEAT-1)未实现:接口字段恒为 None,邻居也只按精确名字匹配,自动边几乎建不起来

- **位置**: `backend/app/services/topology_discovery.py:125`
- **证据**: backend/app/services/topology_discovery.py:122-127(CDP)与 :156-160(LLDP)构造邻居字典时把 `"local_interface": None, "neighbor_interface": None` 硬编码,从未解析 cdpCacheIfIndex/cdpCacheDevicePort 或 lldpRemPortId/lldpRemPortDesc(LLDP OID 也只取 1.0.8802.1.1.2.1.4.1.1.9 一列)。这些 None 直接写进边:topology_discovery.py:235-236 `source_interface=neighbor.get("local_interface"), target_interface=neighbor.get("neighbor_interface")`,于是 topology_edges.source_interface/target_interface(backend/app/models/topology.py:59-60)对自动边永远为 NULL。同时邻居解析仅 `(Device.name == neighbor_name) | (Device.hostname == neighbor_name)`(:182-186),而 CDP/LLDP 上报的是设备名/系统名,IP 无法反查,绝大多数邻居匹配不到直接 continue(:188-189),自动拓扑边基本建不出来。前端 topology.js:1458/1789 生成的端口也来自兜底 `interfaces_count || 8`,与真实端口无关。
- **建议修法**: backend/app/services/topology_discovery.py:102-168 的 CDP 增加 cdpCacheDevicePort(1.3.6.1.4.1.9.9.23.1.2.1.1.7)/cdpCacheAddress,LLDP 增加 lldpRemPortId(1.0.8802.1.1.2.1.4.1.1.7)并按 lldpRemTimeMark/index 关联成行;:182-186 的邻居匹配增加按解析出的管理 IP 反查 Device.ip_address,匹配不到时保留为占位节点而非 continue。
