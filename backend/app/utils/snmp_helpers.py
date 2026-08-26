"""SNMP OID helpers and MIB utilities for metric collection."""

# =============================================================================
# Standard SNMP OIDs for common metrics
# =============================================================================

# System information
SNMP_OID_SYSTEM = {
    "sysDescr": "1.3.6.1.2.1.1.1.0",
    "sysObjectID": "1.3.6.1.2.1.1.2.0",
    "sysUpTime": "1.3.6.1.2.1.1.3.0",
    "sysContact": "1.3.6.1.2.1.1.4.0",
    "sysName": "1.3.6.1.2.1.1.5.0",
    "sysLocation": "1.3.6.1.2.1.1.6.0",
}

# CPU metrics (UCD-SNMP-MIB / NET-SNMP)
SNMP_OID_CPU = {
    "cpu_user": "1.3.6.1.4.1.2021.11.50.0",       # ssCpuUser
    "cpu_system": "1.3.6.1.4.1.2021.11.52.0",      # ssCpuSystem
    "cpu_idle": "1.3.6.1.4.1.2021.11.53.0",        # ssCpuIdle
    "cpu_nice": "1.3.6.1.4.1.2021.11.51.0",        # ssCpuNice
    "cpu_usage_pct": None,  # Computed: 100 - idle
}

# Memory metrics (UCD-SNMP-MIB)
SNMP_OID_MEMORY = {
    "mem_total_real": "1.3.6.1.4.1.2021.4.5.0",    # memTotalReal (KB)
    "mem_avail_real": "1.3.6.1.4.1.2021.4.6.0",    # memAvailReal (KB)
    "mem_total_swap": "1.3.6.1.4.1.2021.4.3.0",    # memTotalSwap (KB)
    "mem_avail_swap": "1.3.6.1.4.1.2021.4.4.0",    # memAvailSwap (KB)
    "mem_buffer": "1.3.6.1.4.1.2021.4.14.0",        # memBuffer (KB)
    "mem_cached": "1.3.6.1.4.1.2021.4.15.0",        # memCached (KB)
}

# Disk metrics (UCD-SNMP-MIB)
SNMP_OID_DISK = {
    "disk_index": "1.3.6.1.4.1.2021.9.1.1",         # dskIndex
    "disk_path": "1.3.6.1.4.1.2021.9.1.2",          # dskPath
    "disk_total": "1.3.6.1.4.1.2021.9.1.6",         # dskTotal (KB)
    "disk_avail": "1.3.6.1.4.1.2021.9.1.7",         # dskAvail (KB)
    "disk_used": "1.3.6.1.4.1.2021.9.1.8",          # dskUsed (KB)
    "disk_pct_inode": "1.3.6.1.4.1.2021.9.1.10",    # dskPercentNode
}

# Network interfaces (IF-MIB)
SNMP_OID_INTERFACES = {
    "if_number": "1.3.6.1.2.1.2.1.0",              # ifNumber
    "if_table": "1.3.6.1.2.1.2.2",                  # ifTable base
    "if_index": "1.3.6.1.2.1.2.2.1.1",             # ifIndex
    "if_descr": "1.3.6.1.2.1.2.2.1.2",             # ifDescr
    "if_type": "1.3.6.1.2.1.2.2.1.3",              # ifType
    "if_mtu": "1.3.6.1.2.1.2.2.1.4",               # ifMtu
    "if_speed": "1.3.6.1.2.1.2.2.1.5",             # ifSpeed
    "if_phys_address": "1.3.6.1.2.1.2.2.1.6",       # ifPhysAddress
    "if_admin_status": "1.3.6.1.2.1.2.2.1.7",      # ifAdminStatus
    "if_oper_status": "1.3.6.1.2.1.2.2.1.8",       # ifOperStatus
    "if_last_change": "1.3.6.1.2.1.2.2.1.9",       # ifLastChange
    "if_in_octets": "1.3.6.1.2.1.2.2.1.10",        # ifInOctets
    "if_out_octets": "1.3.6.1.2.1.2.2.1.16",       # ifOutOctets
    "if_in_errors": "1.3.6.1.2.1.2.2.1.14",        # ifInErrors
    "if_out_errors": "1.3.6.1.2.1.2.2.1.20",       # ifOutErrors
    "if_in_discards": "1.3.6.1.2.1.2.2.1.13",      # ifInDiscards
    "if_out_discards": "1.3.6.1.2.1.2.2.1.19",     # ifOutDiscards
    "if_alias": "1.3.6.1.2.1.31.1.1.1.18",          # ifAlias
}

# CDP / LLDP discovery
SNMP_OID_CDP = {
    "cdp_cache_device_id": "1.3.6.1.4.1.9.9.23.1.2.1.1.6",
    "cdp_cache_device_port": "1.3.6.1.4.1.9.9.23.1.2.1.1.7",
    "cdp_cache_platform": "1.3.6.1.4.1.9.9.23.1.2.1.1.8",
}

SNMP_OID_LLDP = {
    "lldp_rem_sys_name": "1.0.8802.1.1.2.1.4.1.1.9",
    "lldp_rem_port_desc": "1.0.8802.1.1.2.1.4.1.1.8",
    "lldp_rem_sys_desc": "1.0.8802.1.1.2.1.4.1.1.10",
    "lldp_loc_port_desc": "1.0.8802.1.1.2.1.3.7.1.3",
}

# Vendor detection
SNMP_OID_VENDOR = {
    "sysObjectID": "1.3.6.1.2.1.1.2.0",
    "enterprises": "1.3.6.1.4.1",
}

# Well-known enterprise OIDs for vendor identification
VENDOR_OID_MAP = {
    "1.3.6.1.4.1.9": "Cisco",
    "1.3.6.1.4.1.11": "HP",
    "1.3.6.1.4.1.311": "Microsoft",
    "1.3.6.1.4.1.8072": "Net-SNMP",
    "1.3.6.1.4.1.1916": "Extreme",
    "1.3.6.1.4.1.1991": "Brocade",
    "1.3.6.1.4.1.2636": "Juniper",
    "1.3.6.1.4.1.6486": "Alcatel-Lucent",
    "1.3.6.1.4.1.2011": "Huawei",
    "1.3.6.1.4.1.890": "H3C",
    "1.3.6.1.4.1.25506": "HPE",
    "1.3.6.1.4.1.674": "Dell",
    "1.3.6.1.4.1.2.6": "IBM",
    "1.3.6.1.4.1.343": "Intel",
    "1.3.6.1.4.1.789": "NetApp",
    "1.3.6.1.4.1.5951": "F5",
    "1.3.6.1.4.1.3375": "CheckPoint",
    "1.3.6.1.4.1.3224": "Fortinet",
    "1.3.6.1.4.1.338": "MikroTik",
}

IF_TYPE_MAP = {
    1: "other", 6: "ethernet", 7: "ethernet", 11: "ethernet",
    23: "ppp", 24: "loopback", 32: "frame-relay",
    53: "vlan", 54: "vlan", 117: "gigabitEthernet",
    135: "l2vlan", 136: "l3vlan", 161: "lag",
}


def detect_vendor(sys_object_id: str) -> str:
    """Detect vendor from sysObjectID OID value."""
    for oid_prefix, vendor in VENDOR_OID_MAP.items():
        if sys_object_id.startswith(oid_prefix):
            return vendor
    return "Unknown"


def detect_device_type(vendor: str, sys_descr: str) -> str:
    """Detect device type from vendor and system description."""
    descr_lower = sys_descr.lower()

    # Check for specific device types
    if any(kw in descr_lower for kw in ["router", "ios-xr", "junos", "ros"]):
        return "router"
    if any(kw in descr_lower for kw in ["switch", "catalyst", "nexus", "ex2200", "ex3300", "ex4200", "ex4300"]):
        return "switch"
    if any(kw in descr_lower for kw in ["firewall", "asa", "fortigate", "palo alto", "check point"]):
        return "firewall"
    if any(kw in descr_lower for kw in ["linux", "ubuntu", "centos", "debian", "rhel", "red hat"]):
        return "server_linux"
    if any(kw in descr_lower for kw in ["windows", "microsoft", "win"]):
        return "server_windows"

    # Fallback based on vendor
    if vendor in ("Cisco", "Juniper", "Huawei", "H3C", "MikroTik"):
        return "router"
    if vendor in ("Net-SNMP",):
        return "server_linux"

    return "other"
