"""纯函数单元测试:cidr / snmp_helpers / scanner / mib_parser / snmp_profiles / zabbix_converter。"""
from app.services.scanner import NetworkScanner, mac_oui_to_vendor
from app.services.zabbix_converter import parse_zabbix_template, preview_conversion
from app.utils.cidr import parse_network_ranges
from app.utils.mib_parser import parse_cisco_supportlist, parse_mib_oids, resolve_oids_second_pass
from app.utils.snmp_helpers import detect_device_type, detect_vendor
from app.utils.snmp_profiles import PREDEFINED_MODELS, SNMP_PROFILES, get_profile

# ── cidr ────────────────────────────────────────────────────────────────────

def test_cidr_expands_subnet():
    ips = parse_network_ranges(["192.168.1.0/30"])
    assert "192.168.1.1" in ips and "192.168.1.2" in ips


def test_cidr_full_range():
    ips = parse_network_ranges(["10.0.0.1-10.0.0.3"])
    assert {"10.0.0.1", "10.0.0.2", "10.0.0.3"} <= set(ips)


def test_cidr_short_range():
    ips = parse_network_ranges(["10.0.0.5-7"])
    assert {"10.0.0.5", "10.0.0.6", "10.0.0.7"} <= set(ips)


def test_cidr_single_ip_and_invalid():
    ips = parse_network_ranges(["8.8.8.8", "bad-range"])
    assert "8.8.8.8" in ips
    assert "bad-range" not in ips


# ── snmp_helpers ────────────────────────────────────────────────────────────

def test_detect_vendor():
    assert detect_vendor("1.3.6.1.4.1.9.1.1") == "Cisco"
    assert detect_vendor("1.3.6.1.4.1.2011.1.1") == "Huawei"
    assert detect_vendor("9.9.9.9") == "Unknown"


def test_detect_device_type():
    assert detect_device_type("Cisco", "Cisco Catalyst 9300") == "switch"
    assert detect_device_type("Cisco", "Cisco IOS-XR router") == "router"
    assert detect_device_type("Net-SNMP", "Linux ubuntu") == "server_linux"


# ── scanner 纯函数 ──────────────────────────────────────────────────────────

def test_mac_oui_to_vendor():
    assert mac_oui_to_vendor("00:00:0c:aa:bb:cc") == "Cisco"
    assert mac_oui_to_vendor("00:18:fe:12:34:56") == "Huawei"
    assert mac_oui_to_vendor("ff:ff:ff:ff:ff:ff") is None


def test_detect_os():
    sc = NetworkScanner()
    assert sc._detect_os([3389], "") == "Windows"
    assert sc._detect_os([22], "linuxbox") == "Linux/Unix"


def test_detect_os_from_snmp():
    sc = NetworkScanner()
    assert sc._detect_os_from_snmp("Juniper Junos 20.1") == "Juniper JunOS"
    assert sc._detect_os_from_snmp("Cisco IOS Software") == "Cisco IOS"


def test_guess_type_from_ports():
    sc = NetworkScanner()
    assert sc._guess_type_from_ports([161, 22], "Cisco") == "switch"
    assert sc._guess_type_from_ports([22, 80, 443], "") == "server_linux"


# ── mib_parser ──────────────────────────────────────────────────────────────

def test_parse_mib_oids():
    mib_text = """
sysDescr OBJECT-TYPE
    SYNTAX DisplayString (SIZE (0..255))
    DESCRIPTION "A textual description of the entity"
    ::= { system 1 }
"""
    oids = parse_mib_oids(mib_text)
    assert "sysDescr" in oids


def test_parse_cisco_supportlist():
    html = '<a href="ftp://ftp.cisco.com/pub/mibs/v2/CISCO-SYS-MIB.my">Cisco Sys MIB</a>'
    links = parse_cisco_supportlist(html)
    assert len(links) == 1
    assert "github" in links[0]["url"]


def test_resolve_oids_second_pass():
    res = resolve_oids_second_pass({"a": "1.3.6.1", "b": "a 5"})
    assert res.get("b") == "1.3.6.1.5"


# ── snmp_profiles ───────────────────────────────────────────────────────────

def test_get_profile():
    p = get_profile("cisco_ios")
    assert p is not None and p["vendor"] == "Cisco"
    assert get_profile("nope") is None


def test_predefined_model_profiles_valid():
    bad = [m["snmp_profile"] for m in PREDEFINED_MODELS
           if m.get("snmp_profile") and m["snmp_profile"] not in SNMP_PROFILES]
    assert not bad


# ── zabbix_converter ────────────────────────────────────────────────────────

ZABBIX_YAML = """
zabbix_export:
  version: '7.0'
  templates:
    - template: 'Test Router'
      name: 'Test Router'
      groups:
        - name: 'Network'
      items:
        - name: 'CPU usage'
          type: 'SNMP_AGENT'
          snmp_oid: '1.3.6.1.4.1.9.9.109.1.1.1.1.7.1'
          key: 'cpu.usage'
          units: '%'
          history: '7d'
          value_type: 'UNSIGNED'
        - name: 'Ping'
          type: 'ICMP_PING'
          key: 'icmpping'
          history: '7d'
"""


def test_zabbix_template_parse():
    ct = parse_zabbix_template(ZABBIX_YAML)
    assert ct.name == "Test Router"
    assert len(ct.items) == 2
    cpu = [i for i in ct.items if i.metric_name == "CPU usage"][0]
    assert cpu.protocol == "snmp"
    assert cpu.oid_or_key == "1.3.6.1.4.1.9.9.109.1.1.1.1.7.1"
    assert cpu.metric_type == "cpu"
    ping = [i for i in ct.items if i.metric_name == "Ping"][0]
    assert ping.protocol == "icmp"


def test_zabbix_preview():
    pv = preview_conversion(ZABBIX_YAML)
    assert pv["item_count"] == 2
