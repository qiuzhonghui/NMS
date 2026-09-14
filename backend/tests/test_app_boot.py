"""端到端启动隔离测试 —— 用真实 app 验证「外部依赖故障不拖垮进程」。

本环境没有 MySQL,正好用来验证:数据库不可用时,**应用仍然启动并响应**,
失败被隔离并记录在 /api/system/modules,而不是让进程起不来。
"""
from fastapi.testclient import TestClient

import app.main as main_module


def test_app_boots_and_serves_even_without_database():
    """数据库连不上 → 应用照常启动,健康检查与模块报告可用。"""
    with TestClient(main_module.app) as client:
        # 1. 进程健康:核心接口可响应
        r = client.get("/api/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

        # 2. 模块报告:14 个 API 模块全部加载
        r2 = client.get("/api/system/modules")
        assert r2.status_code == 200
        report = r2.json()

        assert len(report["modules"]["loaded"]) == 14, report["modules"]
        assert report["modules"]["failed"] == {}, report["modules"]

        # 3. 数据库失败被隔离记录(本测试环境无 MySQL)
        assert "database" in report["startup_errors"], report
        assert report["healthy"] is False


def test_boot_report_lists_all_services():
    """四个后台服务都应出现在报告中(启动成功或失败均可,但必须被记录)。"""
    with TestClient(main_module.app):
        report = main_module.boot_report
        recorded = set(report.services_started) | set(report.services_failed)
        assert recorded == {"snmp_collector", "icmp_monitor", "alert_engine", "retention"}, recorded


def test_unknown_api_path_returns_404_not_html():
    """未注册的 /api/* 必须返回 404 JSON,而不是 SPA 的 index.html。

    否则某个模块挂掉时,前端会拿到 200 text/html、JSON 解析失败,
    既掩盖了「哪个模块挂了」,也难以定位。
    """
    with TestClient(main_module.app) as client:
        r = client.get("/api/definitely-not-a-real-endpoint")
        assert r.status_code == 404
        assert r.headers["content-type"].startswith("application/json")


def test_spa_route_still_serves_index():
    """非 API 的未知路径仍应回落到 SPA(前端路由依赖这个行为)。"""
    with TestClient(main_module.app) as client:
        r = client.get("/some/spa/route")
        assert r.status_code == 200
        assert "text/html" in r.headers["content-type"]


def test_spa_path_traversal_is_blocked():
    """目录穿越不能读到 FRONTEND_DIR 之外的文件。"""
    with TestClient(main_module.app) as client:
        r = client.get("/..%2f..%2f..%2fWindows%2fwin.ini")
        assert "root:" not in r.text
        assert "[fonts]" not in r.text
