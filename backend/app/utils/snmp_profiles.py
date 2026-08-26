"""
Vendor-specific SNMP OID profiles for device monitoring.
Each profile maps metric types to vendor-specific OIDs.
"""

SNMP_PROFILES = {
    # ═══════════════════════════════════════════════════════════════════════
    # Cisco IOS / IOS-XE
    # ═══════════════════════════════════════════════════════════════════════
    "cisco_ios": {
        "vendor": "Cisco",
        "family": "IOS/IOS-XE",
        "metrics": {
            "cpu": {
                "cpu_5sec": "1.3.6.1.4.1.9.9.109.1.1.1.1.7.1",    # cpmCPUTotal5secRev
                "cpu_1min": "1.3.6.1.4.1.9.9.109.1.1.1.1.6.1",
                "cpu_5min": "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1",
            },
            "memory": {
                "mem_total": "1.3.6.1.4.1.9.9.48.1.1.1.5.1",       # ciscoMemoryPoolUsed + Free
                "mem_used":  "1.3.6.1.4.1.9.9.48.1.1.1.6.1",
                "mem_free":  "1.3.6.1.4.1.9.9.48.1.1.1.6.1",       # computed
            },
            "environment": {
                "temp_sensor": "1.3.6.1.4.1.9.9.13.1.3.1.3",       # ciscoEnvMonTemperatureStatusValue
                "fan_status":  "1.3.6.1.4.1.9.9.13.1.4.1.3",       # ciscoEnvMonFanState
                "psu_status":  "1.3.6.1.4.1.9.9.13.1.5.1.3",
            },
            "cdp": {
                "cache_device_id":   "1.3.6.1.4.1.9.9.23.1.2.1.1.6",
                "cache_device_port": "1.3.6.1.4.1.9.9.23.1.2.1.1.7",
                "cache_platform":    "1.3.6.1.4.1.9.9.23.1.2.1.1.8",
            },
            "vlan": {
                "vlan_name":   "1.3.6.1.4.1.9.9.46.1.3.1.1.4",
                "vlan_status": "1.3.6.1.4.1.9.9.46.1.3.1.1.2",
            },
        },
        "tables": {
            "route":    "1.3.6.1.2.1.4.21",     # ipRouteTable (legacy) or ipCidrRouteTable
            "arp":      "1.3.6.1.2.1.4.22",     # ipNetToMediaTable
            "cdp_neighbors": "1.3.6.1.4.1.9.9.23.1.2.1.1",
        },
    },

    # ═══════════════════════════════════════════════════════════════════════
    # Cisco NX-OS (Nexus)
    # ═══════════════════════════════════════════════════════════════════════
    "cisco_nxos": {
        "vendor": "Cisco",
        "family": "NX-OS",
        "metrics": {
            "cpu": {
                "cpu_5sec": "1.3.6.1.4.1.9.9.109.1.1.1.1.7.1",
                "cpu_1min": "1.3.6.1.4.1.9.9.109.1.1.1.1.6.1",
            },
            "memory": {
                "mem_total": "1.3.6.1.4.1.9.9.305.1.1.2.0",
                "mem_free":  "1.3.6.1.4.1.9.9.305.1.1.1.0",
            },
        },
        "tables": {
            "route": "1.3.6.1.2.1.4.24",  # ipCidrRouteTable
            "arp":   "1.3.6.1.2.1.4.22",
        },
    },

    # ═══════════════════════════════════════════════════════════════════════
    # Huawei VRP (CE/CX/NE/S series)
    # ═══════════════════════════════════════════════════════════════════════
    "huawei_vrp": {
        "vendor": "Huawei",
        "family": "VRP",
        "metrics": {
            "cpu": {
                "cpu_usage":     "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5",   # hwEntityCpuUsage
                "cpu_1min":      "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.7",
                "cpu_threshold": "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.4",
            },
            "memory": {
                "mem_total":  "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.13",  # hwEntityMemSize
                "mem_used":   "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.11",  # hwEntityMemUsage
                "mem_free":   "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.12",
            },
            "environment": {
                "temperature": "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.16",  # hwEntityTemperature
                "fan_status":  "1.3.6.1.4.1.2011.5.25.31.1.1.27.1.4",
                "psu_status":  "1.3.6.1.4.1.2011.5.25.31.1.1.15.1.1.4",
            },
        },
        "tables": {
            "route": "1.3.6.1.2.1.4.21",
            "arp":   "1.3.6.1.2.1.4.22",
            "dhcp":  "1.3.6.1.4.1.2011.5.2.3.42.1.1.3",
        },
    },

    # ═══════════════════════════════════════════════════════════════════════
    # H3C Comware
    # ═══════════════════════════════════════════════════════════════════════
    "h3c_comware": {
        "vendor": "H3C",
        "family": "Comware",
        "metrics": {
            "cpu": {
                "cpu_usage": "1.3.6.1.4.1.25506.2.6.1.1.1.1.6",    # hh3cEntityExtCpuUsage
                "cpu_1min":  "1.3.6.1.4.1.25506.2.6.1.1.1.1.8",
            },
            "memory": {
                "mem_total": "1.3.6.1.4.1.25506.2.6.1.1.1.1.11",   # hh3cEntityExtMemSize
                "mem_used":  "1.3.6.1.4.1.25506.2.6.1.1.1.1.12",
                "mem_free":  "1.3.6.1.4.1.25506.2.6.1.1.1.1.15",
            },
            "environment": {
                "temperature": "1.3.6.1.4.1.25506.2.6.1.1.1.1.17",
                "fan_status":  "1.3.6.1.4.1.25506.2.6.1.1.1.1.21",
            },
        },
        "tables": {
            "route": "1.3.6.1.2.1.4.21",
            "arp":   "1.3.6.1.2.1.4.22",
        },
    },

    # ═══════════════════════════════════════════════════════════════════════
    # Fortinet FortiOS (FortiGate)
    # ═══════════════════════════════════════════════════════════════════════
    "fortinet_fortios": {
        "vendor": "Fortinet",
        "family": "FortiOS",
        "metrics": {
            "cpu": {
                "cpu_usage": "1.3.6.1.4.1.12356.101.4.1.3.0",      # fgSysCpuUsage
            },
            "memory": {
                "mem_total": "1.3.6.1.4.1.12356.101.4.1.4.0",      # fgSysMemCapacity
                "mem_used":  "1.3.6.1.4.1.12356.101.4.1.5.0",      # fgSysMemUsage
            },
            "sessions": {
                "active":    "1.3.6.1.4.1.12356.101.4.1.9.0",      # fgSysSesCount
            },
            "firewall": {
                "policy_count": "1.3.6.1.4.1.12356.101.4.1.8.0",   # fgSysPolCount
                "virus_count":  "1.3.6.1.4.1.12356.101.8.1.1.0",
            },
        },
        "tables": {
            "route": "1.3.6.1.2.1.4.21",
            "arp":   "1.3.6.1.2.1.4.22",
            "vpn":   "1.3.6.1.4.1.12356.101.12.2.2.1",
        },
    },

    # ═══════════════════════════════════════════════════════════════════════
    # Juniper JunOS
    # ═══════════════════════════════════════════════════════════════════════
    "juniper_junos": {
        "vendor": "Juniper",
        "family": "JunOS",
        "metrics": {
            "cpu": {
                "cpu_1min": "1.3.6.1.4.1.2636.3.1.13.1.8.7.1.0",  # jnxOperatingCPU (RE)
            },
            "memory": {
                "mem_heap": "1.3.6.1.4.1.2636.3.1.13.1.11.7.1.0",
                "mem_buf":  "1.3.6.1.4.1.2636.3.1.13.1.12.7.1.0",
            },
            "environment": {
                "temp": "1.3.6.1.4.1.2636.3.1.13.1.7.7.1.0",
            },
        },
        "tables": {
            "route": "1.3.6.1.2.1.4.21",
            "arp":   "1.3.6.1.2.1.4.22",
        },
    },

    # ═══════════════════════════════════════════════════════════════════════
    # MikroTik RouterOS
    # ═══════════════════════════════════════════════════════════════════════
    "mikrotik_ros": {
        "vendor": "MikroTik",
        "family": "RouterOS",
        "metrics": {
            "cpu": {
                "cpu_load": "1.3.6.1.4.1.14988.1.1.3.10.0",       # mtxrHlCpuLoad
            },
            "memory": {
                "mem_total": "1.3.6.1.4.1.14988.1.1.3.12.0",      # mtxrHlTotalMemory
                "mem_free":  "1.3.6.1.4.1.14988.1.1.3.11.0",      # mtxrHlFreeMemory
            },
            "disk": {
                "disk_total": "1.3.6.1.4.1.14988.1.1.3.7.0",
                "disk_free":  "1.3.6.1.4.1.14988.1.1.3.8.0",
            },
            "health": {
                "voltage": "1.3.6.1.4.1.14988.1.1.3.9.0",
                "temp":    "1.3.6.1.4.1.14988.1.1.3.13.0",
            },
        },
        "tables": {
            "route": "1.3.6.1.2.1.4.21",
            "arp":   "1.3.6.1.2.1.4.22",
            "dhcp_leases": "1.3.6.1.4.1.14988.1.1.6.1.1.1",
        },
    },

    # ═══════════════════════════════════════════════════════════════════════
    # Dell PowerConnect / Force10
    # ═══════════════════════════════════════════════════════════════════════
    "dell_powerconnect": {
        "vendor": "Dell",
        "family": "PowerConnect/OS10",
        "metrics": {
            "cpu": {
                "cpu_5sec": "1.3.6.1.4.1.89.1.7.0",
            },
            "memory": {
                "mem_total": "1.3.6.1.4.1.89.1.8.0",
                "mem_free":  "1.3.6.1.4.1.89.1.9.0",
            },
        },
        "tables": {
            "route": "1.3.6.1.2.1.4.21",
            "arp":   "1.3.6.1.2.1.4.22",
        },
    },

    # ═══════════════════════════════════════════════════════════════════════
    # OPNsense / pfSense (FreeBSD-based)
    # ═══════════════════════════════════════════════════════════════════════
    "opnsense": {
        "vendor": "OPNsense",
        "family": "FreeBSD",
        "metrics": {
            "cpu": {
                "cpu_user":   "1.3.6.1.4.1.2021.11.50.0",
                "cpu_system": "1.3.6.1.4.1.2021.11.52.0",
                "cpu_idle":   "1.3.6.1.4.1.2021.11.53.0",
            },
            "memory": {
                "mem_total_real": "1.3.6.1.4.1.2021.4.5.0",
                "mem_avail_real": "1.3.6.1.4.1.2021.4.6.0",
                "mem_total_swap": "1.3.6.1.4.1.2021.4.3.0",
                "mem_avail_swap": "1.3.6.1.4.1.2021.4.4.0",
            },
        },
        "tables": {
            "route": "1.3.6.1.2.1.4.21",
            "arp":   "1.3.6.1.2.1.4.22",
        },
    },

    "pfsense": {
        "vendor": "pfSense",
        "family": "FreeBSD",
        "metrics": {
            "cpu": {
                "cpu_user":   "1.3.6.1.4.1.2021.11.50.0",
                "cpu_system": "1.3.6.1.4.1.2021.11.52.0",
                "cpu_idle":   "1.3.6.1.4.1.2021.11.53.0",
            },
            "memory": {
                "mem_total_real": "1.3.6.1.4.1.2021.4.5.0",
                "mem_avail_real": "1.3.6.1.4.1.2021.4.6.0",
                "mem_buffer":     "1.3.6.1.4.1.2021.4.14.0",
                "mem_cached":     "1.3.6.1.4.1.2021.4.15.0",
            },
        },
        "tables": {
            "route": "1.3.6.1.2.1.4.21",
            "arp":   "1.3.6.1.2.1.4.22",
        },
    },

    # ═══════════════════════════════════════════════════════════════════════
    # OpenWrt
    # ═══════════════════════════════════════════════════════════════════════
    "openwrt": {
        "vendor": "OpenWrt",
        "family": "Linux (OpenWrt)",
        "metrics": {
            "cpu": {
                "cpu_user":   "1.3.6.1.4.1.2021.11.50.0",
                "cpu_system": "1.3.6.1.4.1.2021.11.52.0",
                "cpu_idle":   "1.3.6.1.4.1.2021.11.53.0",
            },
            "memory": {
                "mem_total_real": "1.3.6.1.4.1.2021.4.5.0",
                "mem_avail_real": "1.3.6.1.4.1.2021.4.6.0",
            },
            "network": {
                "wifi_clients": "1.3.6.1.4.1.2021.9.1.1",     # approximate
            },
        },
        "tables": {
            "route": "1.3.6.1.2.1.4.21",
            "arp":   "1.3.6.1.2.1.4.22",
            "dhcp_leases": "1.3.6.1.4.1.2021.100.1.1.1",
        },
    },

    # ═══════════════════════════════════════════════════════════════════════
    # iKuai
    # ═══════════════════════════════════════════════════════════════════════
    "ikuai": {
        "vendor": "iKuai",
        "family": "Custom Linux",
        "metrics": {
            "cpu": {
                "cpu_user":   "1.3.6.1.4.1.2021.11.50.0",
                "cpu_system": "1.3.6.1.4.1.2021.11.52.0",
                "cpu_idle":   "1.3.6.1.4.1.2021.11.53.0",
            },
            "memory": {
                "mem_total_real": "1.3.6.1.4.1.2021.4.5.0",
                "mem_avail_real": "1.3.6.1.4.1.2021.4.6.0",
            },
        },
        "tables": {
            "route": "1.3.6.1.2.1.4.21",
            "arp":   "1.3.6.1.2.1.4.22",
        },
    },

    # ═══════════════════════════════════════════════════════════════════════
    # Generic Linux (UCD-SNMP-MIB / NET-SNMP)
    # ═══════════════════════════════════════════════════════════════════════
    "linux_generic": {
        "vendor": "Generic",
        "family": "Linux (Net-SNMP)",
        "metrics": {
            "cpu": {
                "cpu_user":   "1.3.6.1.4.1.2021.11.50.0",
                "cpu_system": "1.3.6.1.4.1.2021.11.52.0",
                "cpu_idle":   "1.3.6.1.4.1.2021.11.53.0",
                "cpu_nice":   "1.3.6.1.4.1.2021.11.51.0",
            },
            "memory": {
                "mem_total_real": "1.3.6.1.4.1.2021.4.5.0",
                "mem_avail_real": "1.3.6.1.4.1.2021.4.6.0",
                "mem_total_swap": "1.3.6.1.4.1.2021.4.3.0",
                "mem_avail_swap": "1.3.6.1.4.1.2021.4.4.0",
                "mem_buffer":     "1.3.6.1.4.1.2021.4.14.0",
                "mem_cached":     "1.3.6.1.4.1.2021.4.15.0",
            },
            "disk": {
                "disk_index": "1.3.6.1.4.1.2021.9.1.1",
                "disk_path":  "1.3.6.1.4.1.2021.9.1.2",
                "disk_total": "1.3.6.1.4.1.2021.9.1.6",
                "disk_avail": "1.3.6.1.4.1.2021.9.1.7",
                "disk_used":  "1.3.6.1.4.1.2021.9.1.8",
            },
            "system": {
                "uptime":    "1.3.6.1.2.1.1.3.0",
                "processes": "1.3.6.1.2.1.25.1.6.0",
                "users":     "1.3.6.1.2.1.25.1.5.0",
            },
        },
        "tables": {
            "route":    "1.3.6.1.2.1.4.21",
            "arp":      "1.3.6.1.2.1.4.22",
            "tcp_conn": "1.3.6.1.2.1.6.13",
        },
    },

    # ═══════════════════════════════════════════════════════════════════════
    # Windows (SNMP service)
    # ═══════════════════════════════════════════════════════════════════════
    "windows_generic": {
        "vendor": "Microsoft",
        "family": "Windows",
        "metrics": {
            "cpu": {
                "cpu_user":   "1.3.6.1.4.1.2021.11.50.0",
                "cpu_system": "1.3.6.1.4.1.2021.11.52.0",
                "cpu_idle":   "1.3.6.1.4.1.2021.11.53.0",
            },
            "memory": {
                "mem_total_real": "1.3.6.1.4.1.2021.4.5.0",
                "mem_avail_real": "1.3.6.1.4.1.2021.4.6.0",
            },
            "disk": {
                "disk_index": "1.3.6.1.4.1.2021.9.1.1",
                "disk_path":  "1.3.6.1.4.1.2021.9.1.2",
                "disk_total": "1.3.6.1.4.1.2021.9.1.6",
                "disk_avail": "1.3.6.1.4.1.2021.9.1.7",
            },
            "system": {
                "uptime":    "1.3.6.1.2.1.1.3.0",
                "processes": "1.3.6.1.2.1.25.1.6.0",
            },
        },
        "tables": {
            "route": "1.3.6.1.2.1.4.21",
            "arp":   "1.3.6.1.2.1.4.22",
        },
    },
}

# ═════════════════════════════════════════════════════════════════════════
# Pre-defined device models shipped with NMS
# ═════════════════════════════════════════════════════════════════════════

PREDEFINED_MODELS = [
    # ── Cisco ────────────────────────────────────────────────────────────
    {"vendor": "Cisco", "model_name": "ISR 4331",           "device_type": "router",   "category": "network", "snmp_profile": "cisco_ios"},
    {"vendor": "Cisco", "model_name": "ISR 4451",           "device_type": "router",   "category": "network", "snmp_profile": "cisco_ios"},
    {"vendor": "Cisco", "model_name": "Catalyst 9200",      "device_type": "switch",   "category": "network", "snmp_profile": "cisco_ios"},
    {"vendor": "Cisco", "model_name": "Catalyst 9300",      "device_type": "switch",   "category": "network", "snmp_profile": "cisco_ios"},
    {"vendor": "Cisco", "model_name": "Catalyst 9500",      "device_type": "switch",   "category": "network", "snmp_profile": "cisco_ios"},
    {"vendor": "Cisco", "model_name": "Nexus 93180YC",      "device_type": "switch",   "category": "network", "snmp_profile": "cisco_nxos"},
    {"vendor": "Cisco", "model_name": "ASA 5516-X",         "device_type": "firewall", "category": "network", "snmp_profile": "cisco_ios"},
    {"vendor": "Cisco", "model_name": "Firepower 2110",     "device_type": "firewall", "category": "network", "snmp_profile": "cisco_ios"},
    # ── Huawei ───────────────────────────────────────────────────────────
    {"vendor": "Huawei", "model_name": "CE6800",            "device_type": "switch",   "category": "network", "snmp_profile": "huawei_vrp"},
    {"vendor": "Huawei", "model_name": "CE12800",           "device_type": "switch",   "category": "network", "snmp_profile": "huawei_vrp"},
    {"vendor": "Huawei", "model_name": "NE40E",             "device_type": "router",   "category": "network", "snmp_profile": "huawei_vrp"},
    {"vendor": "Huawei", "model_name": "AR6300",            "device_type": "router",   "category": "network", "snmp_profile": "huawei_vrp"},
    {"vendor": "Huawei", "model_name": "USG6600E",          "device_type": "firewall", "category": "network", "snmp_profile": "huawei_vrp"},
    # ── H3C ──────────────────────────────────────────────────────────────
    {"vendor": "H3C", "model_name": "S6850",                "device_type": "switch",   "category": "network", "snmp_profile": "h3c_comware"},
    {"vendor": "H3C", "model_name": "S6520X",               "device_type": "switch",   "category": "network", "snmp_profile": "h3c_comware"},
    {"vendor": "H3C", "model_name": "SR6608",               "device_type": "router",   "category": "network", "snmp_profile": "h3c_comware"},
    {"vendor": "H3C", "model_name": "MSR3600",              "device_type": "router",   "category": "network", "snmp_profile": "h3c_comware"},
    {"vendor": "H3C", "model_name": "F5000",                "device_type": "firewall", "category": "network", "snmp_profile": "h3c_comware"},
    # ── Fortinet ─────────────────────────────────────────────────────────
    {"vendor": "Fortinet", "model_name": "FortiGate 100F",  "device_type": "firewall", "category": "network", "snmp_profile": "fortinet_fortios"},
    {"vendor": "Fortinet", "model_name": "FortiGate 200F",  "device_type": "firewall", "category": "network", "snmp_profile": "fortinet_fortios"},
    {"vendor": "Fortinet", "model_name": "FortiGate 600E",  "device_type": "firewall", "category": "network", "snmp_profile": "fortinet_fortios"},
    # ── Juniper ──────────────────────────────────────────────────────────
    {"vendor": "Juniper", "model_name": "MX204",            "device_type": "router",   "category": "network", "snmp_profile": "juniper_junos"},
    {"vendor": "Juniper", "model_name": "EX3400",           "device_type": "switch",   "category": "network", "snmp_profile": "juniper_junos"},
    {"vendor": "Juniper", "model_name": "SRX340",           "device_type": "firewall", "category": "network", "snmp_profile": "juniper_junos"},
    # ── MikroTik ─────────────────────────────────────────────────────────
    {"vendor": "MikroTik", "model_name": "CCR2004",         "device_type": "router",   "category": "network", "snmp_profile": "mikrotik_ros"},
    {"vendor": "MikroTik", "model_name": "CRS326",          "device_type": "switch",   "category": "network", "snmp_profile": "mikrotik_ros"},
    {"vendor": "MikroTik", "model_name": "RB4011",          "device_type": "router",   "category": "network", "snmp_profile": "mikrotik_ros"},
    # ── OPNsense / pfSense / OpenWrt / iKuai ─────────────────────────────
    {"vendor": "OPNsense",   "model_name": "Generic",        "device_type": "firewall", "category": "network", "snmp_profile": "opnsense"},
    {"vendor": "pfSense",    "model_name": "Generic",        "device_type": "firewall", "category": "network", "snmp_profile": "pfsense"},
    {"vendor": "OpenWrt",    "model_name": "Generic",        "device_type": "router",   "category": "network", "snmp_profile": "openwrt"},
    {"vendor": "iKuai",      "model_name": "Generic",        "device_type": "router",   "category": "network", "snmp_profile": "ikuai"},
    # ── Generic servers ────────────────────────────────────────────────
    {"vendor": "Generic", "model_name": "Linux Server",     "device_type": "server_linux",   "category": "server", "snmp_profile": "linux_generic"},
    {"vendor": "Generic", "model_name": "Windows Server",   "device_type": "server_windows", "category": "server", "snmp_profile": "windows_generic"},
    {"vendor": "Generic", "model_name": "Windows 10/11",    "device_type": "server_windows", "category": "server", "snmp_profile": "windows_generic"},
    {"vendor": "Generic", "model_name": "Rocky Linux",      "device_type": "server_linux",   "category": "server", "snmp_profile": "linux_generic"},
    {"vendor": "Generic", "model_name": "Debian",           "device_type": "server_linux",   "category": "server", "snmp_profile": "linux_generic"},
    {"vendor": "Generic", "model_name": "Arch Linux",        "device_type": "server_linux",   "category": "server", "snmp_profile": "linux_generic"},
]


def get_profile(name: str) -> dict | None:
    """Get a vendor SNMP profile by name."""
    return SNMP_PROFILES.get(name)
