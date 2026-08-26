"""统一 SNMP 服务单元测试:mock pysnmp / subprocess,验证 4 个原语逻辑。"""
import asyncio
import subprocess
from unittest import mock

from app.services import snmp


class _FakeResult:
    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def test_snmp_get_parses_value():
    with mock.patch.object(subprocess, "run", return_value=_FakeResult(
            0, '1.3.6.1.2.1.1.1.0 = STRING: "Cisco IOS"\n')):
        assert snmp.snmp_get("10.0.0.1", "1.3.6.1.2.1.1.1.0") == '"Cisco IOS"'


def test_snmp_get_falls_back_to_bare_oid():
    side = [
        _FakeResult(0, "No Such Object available on this agent at this OID"),
        _FakeResult(0, '1.3.6.1.2.1.1.1.0 = STRING: "linux host"\n'),
    ]
    with mock.patch.object(subprocess, "run", side_effect=side):
        assert snmp.snmp_get("10.0.0.1", "1.3.6.1.2.1.1.1.0") == '"linux host"'


def test_snmp_get_failure_returns_no_response():
    with mock.patch.object(subprocess, "run", return_value=_FakeResult(2, "", "Timeout")):
        assert snmp.snmp_get("10.0.0.1", "1.3.6.1.2.1.1.1.0") == "No response"


def test_snmp_walk_parses_rows():
    out = ("1.3.6.1.2.1.2.2.1.2.1 = STRING: Gi0/1\n"
           "1.3.6.1.2.1.2.2.1.2.2 = STRING: Gi0/2\n")
    with mock.patch.object(subprocess, "run", return_value=_FakeResult(0, out)):
        rows = asyncio.run(snmp.snmp_walk("10.0.0.1", "1.3.6.1.2.1.2.2.1.2"))
    assert len(rows) == 2
    assert rows[0]["value"] == "Gi0/1"


async def _fake_get_many(*args, **kwargs):
    return (None, None, None, [(None, 12345), (None, b"abc"), (None, "42.5")])


def test_snmp_get_many_coerces_values():
    with mock.patch.object(snmp, "get_cmd", _fake_get_many):
        res = asyncio.run(snmp.snmp_get_many(
            "10.0.0.1", {"a": "1.3.6.1", "b": "1.3.6.2", "c": "1.3.6.3"}))
    assert res["a"] == 12345
    assert res["b"] == "abc"
    # 与原实现一致:非整数浮点字符串("42.5")因 int() 失败被跳过
    assert "c" not in res


async def _fake_get_error(*args, **kwargs):
    return ("timeout", None, None, None)


def test_snmp_get_many_error_returns_empty():
    with mock.patch.object(snmp, "get_cmd", _fake_get_error):
        assert asyncio.run(snmp.snmp_get_many("10.0.0.1", {"a": "1.3.6.1"})) == {}


_call_count = 0


async def _fake_probe(*args, **kwargs):
    global _call_count
    _call_count += 1
    if _call_count == 1:
        return (None, None, None, [
            (None, "Cisco IOS Software"),
            (None, "1.3.6.1.4.1.9.1.1"),
            (None, "SW1"),
            (None, "RackA"),
            (None, "admin"),
        ])
    return (None, None, None, [(None, 24)])


def test_system_probe():
    global _call_count
    _call_count = 0
    with mock.patch.object(snmp, "get_cmd", _fake_probe):
        info = asyncio.run(snmp.system_probe("10.0.0.1", "public",
                                             os_detector=lambda d: "Cisco IOS"))
    assert info["vendor"] == "Cisco"
    assert info["hostname"] == "SW1"
    assert info["device_type"] == "router"
    assert info["os_type"] == "Cisco IOS"
    assert info["if_count"] == 24
