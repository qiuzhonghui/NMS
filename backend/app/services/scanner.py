"""Network scanner — ICMP ping → SNMP probe → ARP/MAC identification."""
import asyncio
import os
import re
import socket
import subprocess
from typing import AsyncIterator, Optional

from loguru import logger

try:
    from ping3 import ping
except ImportError:
    ping = None

from ..services.snmp import SNMP_AVAILABLE, system_probe
from ..config import settings


# ═══════════════════════════════════════════════════════════════════════════
# MAC OUI database — maps OUI prefixes to vendor names
# ═══════════════════════════════════════════════════════════════════════════

MAC_OUI_MAP = {
    "00:00:0c": "Cisco",      "00:01:42": "Cisco",      "00:01:43": "Cisco",
    "00:1a:a1": "Cisco",      "00:1a:a2": "Cisco",      "00:1b:54": "Cisco",
    "00:1e:14": "Cisco",      "00:1e:f7": "Cisco",      "00:23:33": "Cisco",
    "00:25:45": "Cisco",      "00:26:0b": "Cisco",      "00:26:99": "Cisco",
    "70:81:05": "Cisco",      "f8:72:ea": "Cisco",      "fc:fb:fb": "Cisco",
    "00:0d:65": "Cisco",      "00:0d:bc": "Cisco",      "00:0e:38": "Cisco",
    "00:16:9c": "Cisco",      "00:17:e0": "Cisco",      "00:19:06": "Cisco",
    "00:1b:d5": "Cisco",      "00:1b:d6": "Cisco",      "00:1c:0f": "Cisco",
    "00:1c:b0": "Cisco",      "e0:2f:6d": "Cisco",      "40:f4:ec": "Cisco",
    "84:b8:02": "Cisco",      "f4:4e:05": "Cisco",
    "00:1e:c1": "Cisco-Linksys",
    "00:15:2b": "Cisco",
    "00:18:18": "Cisco",
    "00:1d:a1": "Cisco",
    "00:24:96": "Cisco",
    "00:27:0d": "Cisco",
    "00:16:c7": "Cisco",
    "3c:57:31": "Cisco",
    "00:22:55": "Cisco",
    "00:26:52": "Cisco",
    "68:ef:bd": "Cisco",
    "f0:29:29": "Cisco",
    "58:97:bd": "Cisco",
    "a4:4c:11": "Cisco",
    "a8:b1:d4": "Cisco",

    "00:1b:eb": "Dell",       "00:21:70": "Dell",       "00:22:19": "Dell",
    "00:25:64": "Dell",       "00:26:b9": "Dell",       "b8:ac:6f": "Dell",
    "f0:4d:a2": "Dell",       "d0:67:e5": "Dell",       "18:03:73": "Dell",
    "14:18:77": "Dell",       "24:b6:fd": "Dell",       "d4:be:d9": "Dell",
    "28:f1:0e": "Dell",       "50:9a:4c": "Dell",

    "00:17:a4": "HP",         "00:1b:78": "HP",         "00:1c:c4": "HP",
    "00:21:5a": "HP",         "00:22:64": "HP",         "00:25:b3": "HP",
    "00:26:8a": "HP",         "00:30:c1": "HP",         "d8:d3:85": "HP",
    "3c:d9:2b": "HP",         "84:2b:2b": "Dell",       "a0:b3:cc": "HP",
    "b4:99:ba": "HP",         "e8:39:35": "HP",         "80:c1:6e": "HP",
    "00:25:b0": "Dell",

    "00:18:fe": "Huawei",     "00:1e:10": "Huawei",     "00:25:9e": "Huawei",
    "08:19:a6": "Huawei",     "20:0b:c7": "Huawei",     "24:1f:a0": "Huawei",
    "28:6e:d4": "Huawei",     "30:1a:22": "Huawei",     "48:46:c1": "Huawei",
    "54:89:98": "Huawei",     "78:d7:52": "Huawei",     "ac:85:3d": "Huawei",
    "dc:99:14": "Huawei",     "e0:24:7f": "Huawei",     "fc:48:ef": "Huawei",
    "00:0e:fc": "Huawei",     "00:46:4b": "Huawei",

    "00:0f:e2": "H3C",        "00:0f:e0": "H3C",        "00:23:89": "H3C",
    "08:63:61": "H3C",        "38:22:d6": "H3C",        "3c:e5:a6": "H3C",
    "58:66:ba": "H3C",        "70:7b:e8": "H3C",        "74:25:8a": "H3C",
    "80:f6:2e": "H3C",        "84:d9:31": "H3C",        "b8:af:67": "H3C",

    "00:10:db": "Juniper",    "00:12:1e": "Juniper",    "00:14:f6": "Juniper",
    "00:19:e2": "Juniper",    "00:22:83": "Juniper",    "00:23:9c": "Juniper",
    "28:c0:da": "Juniper",    "2c:21:72": "Juniper",    "4c:96:14": "Juniper",
    "54:e0:32": "Juniper",    "84:18:88": "Juniper",    "88:a2:5e": "Juniper",
    "b0:c6:9a": "Juniper",

    "00:09:0f": "Fortinet",   "00:1c:f6": "Fortinet",   "08:5b:0e": "Fortinet",
    "10:a9:3d": "Fortinet",   "20:0f:1e": "Fortinet",   "70:4c:a5": "Fortinet",
    "90:6c:ac": "Fortinet",   "d0:4d:2c": "Fortinet",   "e8:1c:ba": "Fortinet",

    "00:0c:42": "MikroTik",   "00:15:6d": "MikroTik",   "08:55:31": "MikroTik",
    "4c:5e:0c": "MikroTik",   "6c:3b:6b": "MikroTik",   "d4:ca:6d": "MikroTik",
    "e4:8d:8c": "MikroTik",

    "00:0c:29": "VMware",     "00:50:56": "VMware",     "00:05:69": "VMware",

    "08:00:27": "VirtualBox",
    "00:1c:42": "Parallels",
    "00:15:5d": "Hyper-V",
    "00:03:ff": "Microsoft",
    "00:16:3e": "Xen",

    "00:50:8b": "Compaq",     "00:50:8b": "HP",
    "00:02:c9": "Mellanox",
    "00:1b:21": "Intel",      "00:15:17": "Intel",      "00:1e:64": "Intel",
    "00:21:6a": "Intel",      "a0:36:9f": "Intel",      "e4:42:a6": "Intel",
    "00:e0:4c": "Realtek",    "00:e0:4d": "Realtek",
    "00:0d:88": "D-Link",     "00:1b:11": "D-Link",
    "00:1c:f0": "D-Link",     "00:22:b0": "D-Link",
    "00:26:5a": "D-Link",     "c8:d3:a3": "D-Link",
    "00:14:bf": "Netgear",    "00:1b:2f": "Netgear",
    "00:1e:2a": "Netgear",    "2c:b0:5d": "Netgear",
    "00:18:4d": "Netgear",    "00:22:3f": "Netgear",
    "00:21:91": "D-Link",     "00:24:01": "D-Link",
    "00:26:f2": "Netgear",    "c4:3d:c7": "Netgear",
    "00:04:5a": "Linksys",
    "00:13:10": "Linksys",
    "00:16:b6": "Linksys",
    "00:18:f8": "Linksys",
    "00:19:39": "Linksys",
    "00:21:29": "Linksys",
    "00:25:9c": "Linksys",
    "c0:c1:c0": "Linksys",
    "00:08:a1": "Aruba",      "00:0b:86": "Aruba",      "00:1a:1e": "Aruba",
    "00:24:6c": "Aruba",      "20:4c:03": "Aruba",      "24:de:c6": "Aruba",
    "6c:f3:7f": "Aruba",      "d8:c7:c8": "Aruba",      "f0:5c:19": "Aruba",

    "d4:01:29": "Broadcom",   "d8:9d:67": "Broadcom",
    "00:0a:f7": "Broadcom",
    "00:90:fb": "Broadcom",
    "00:26:55": "Broadcom",
    "00:11:bc": "Broadcom",
    "00:25:90": "Broadcom",
    "00:02:55": "IBM",
    "00:09:6b": "IBM",
    "00:14:5e": "IBM",
    "00:1a:64": "IBM",
    "00:21:5e": "IBM",
    "5c:f3:fc": "IBM",

    "00:08:9b": "NetApp",
    "00:a0:98": "NetApp",
    "00:1e:68": "Quanta",
    "00:21:28": "Quanta",
    "d0:bf:9c": "CheckPoint",
    "00:1c:7f": "Check Point",
    "00:1d:72": "Palo Alto",   "00:1b:d0": "Palo Alto",
    "b4:0c:25": "Palo Alto",   "f8:32:9b": "Palo Alto",
    "00:90:0b": "Ubiquiti",    "00:15:6d": "Ubiquiti",
    "04:18:d6": "Ubiquiti",    "24:a4:3c": "Ubiquiti",
    "44:d9:e7": "Ubiquiti",    "78:8a:20": "Ubiquiti",
    "80:2a:a8": "Ubiquiti",    "dc:9f:db": "Ubiquiti",
    "fc:ec:da": "Ubiquiti",

    "00:1a:79": "Samsung",    "00:1e:11": "Samsung",
    "00:23:08": "Samsung",    "00:25:38": "Samsung",
    "0c:89:10": "Samsung",    "38:01:46": "Samsung",
    "00:15:99": "Samsung",    "00:16:6c": "Samsung",
    "00:1c:43": "Samsung",    "00:1d:25": "Samsung",
    "18:67:b0": "Samsung",    "5c:cb:99": "Samsung",
    "84:38:38": "Samsung",    "a0:1c:05": "Xiaomi",
    "98:9c:57": "Xiaomi",     "a4:6a:a8": "Xiaomi",
    "44:a6:fa": "Xiaomi",     "70:8b:cd": "Xiaomi",
    "00:9e:c8": "Xiaomi",     "28:6c:df": "Xiaomi",
    "00:08:22": "Nokia",      "00:19:3e": "Nokia",
    "a0:40:25": "Nokia",      "00:1e:ca": "Nokia",
    "f4:93:9f": "Apple",      "f0:d1:a9": "Apple",
    "00:1b:63": "Apple",      "00:21:e9": "Apple",
    "00:26:08": "Apple",      "04:1e:64": "Apple",

}


def mac_oui_to_vendor(mac: str) -> str | None:
    """Identify vendor from MAC — nmap database first, then local OUI map."""
    if not mac: return None
    mac = mac.replace("-", ":").lower()
    # 1. Try nmap's OUI database (most accurate)
    prefix6 = mac.replace(":", "")[:6].upper()
    for path in ["/usr/share/nmap/nmap-mac-prefixes", "/usr/local/share/nmap/nmap-mac-prefixes"]:
        try:
            with open(path) as f:
                for line in f:
                    if line.startswith(prefix6):
                        vendor = line.split(None, 1)
                        if len(vendor) > 1 and vendor[1].strip():
                            return vendor[1].strip()
        except Exception: pass
    # 2. Local OUI map as fallback
    for prefix, vendor in MAC_OUI_MAP.items():
        if mac.startswith(prefix.lower()):
            return vendor
    return None


def _read_arp_table() -> dict[str, dict]:
    """Read local ARP table. Returns {ip: {mac, interface}}."""
    arp = {}
    # /proc/net/arp
    try:
        with open("/proc/net/arp") as f:
            for line in f.readlines()[1:]:
                parts = line.split()
                if len(parts) >= 4:
                    ip, mac = parts[0], parts[3]
                    if mac != "00:00:00:00:00:00":
                        arp[ip] = {"mac": mac, "vendor": mac_oui_to_vendor(mac)}
    except Exception: pass
    # arp -an (works after ping triggers ARP)
    try:
        output = subprocess.check_output(["arp", "-an"], text=True, timeout=3)
        for line in output.split("\n"):
            m = re.search(r'\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-f:]+)', line, re.IGNORECASE)
            if m:
                ip, mac = m.group(1), m.group(2)
                if ip not in arp and mac != "00:00:00:00:00:00":
                    arp[ip] = {"mac": mac, "vendor": mac_oui_to_vendor(mac)}
    except Exception: pass
    return arp


def _get_arp_for_ip(ip: str) -> dict | None:
    """Get ARP entry for a specific IP (call AFTER pinging)."""
    # Method 1: arp -n (fast, after ping populates cache)
    try:
        output = subprocess.check_output(["arp", "-n", ip], text=True, timeout=2, stderr=subprocess.DEVNULL)
        m = re.search(r'([0-9a-f]{1,2}:[0-9a-f]{1,2}:[0-9a-f]{1,2}:[0-9a-f]{1,2}:[0-9a-f]{1,2}:[0-9a-f]{1,2})', output, re.IGNORECASE)
        if m:
            mac = m.group(1)
            return {"mac": mac, "vendor": mac_oui_to_vendor(mac)}
    except Exception: pass
    # Method 2: try with sudo
    try:
        output = subprocess.check_output(["sudo", "arp", "-n", ip], text=True, timeout=2, stderr=subprocess.DEVNULL)
        m = re.search(r'([0-9a-f:]{17})', output, re.IGNORECASE)
        if m:
            mac = m.group(1)
            return {"mac": mac, "vendor": mac_oui_to_vendor(mac)}
    except Exception: pass
    # Method 3: read full ARP table
    return _read_arp_table().get(ip)


def nmap_scan(ip: str) -> dict | None:
    """Use nmap for reliable device discovery (MAC, OS, ports, hostname)."""
    try:
        # Try sudo first (needed for ARP), fall back to regular nmap
        nmap_cmd = ["sudo", "nmap", "-PE", "-sn", "-n", "--host-timeout", "3s", "--max-retries", "2", ip]
        try:
            output = subprocess.check_output(nmap_cmd, text=True, timeout=6, stderr=subprocess.DEVNULL)
        except Exception:
            nmap_cmd = ["nmap", "-PE", "-sn", "-n", "--host-timeout", "3s", "--max-retries", "2", ip]
            output = subprocess.check_output(nmap_cmd, text=True, timeout=6, stderr=subprocess.DEVNULL)
        result: dict = {"ip_address": ip}

        # MAC address
        mac_m = re.search(r'MAC Address:\s*([0-9A-F:]+)\s*\((.+?)\)', output, re.IGNORECASE)
        if mac_m:
            result["mac_address"] = mac_m.group(1)
            result["vendor"] = mac_m.group(2).strip()
        else:
            # Try arp after nmap ping
            arp = _get_arp_for_ip(ip)
            if arp:
                result["mac_address"] = arp.get("mac")
                if arp.get("vendor"):
                    result["vendor"] = arp["vendor"]

        return result if len(result) > 1 else None  # at least IP+something
    except FileNotFoundError:
        logger.debug("nmap not installed")
        return None
    except Exception as e:
        logger.debug(f"nmap scan failed for {ip}: {e}")
        return None


def nmap_scan_detailed(ip: str) -> dict | None:
    """Full nmap scan with OS detection and port scan."""
    try:
        output = subprocess.check_output(
            ["nmap", "-O", "-sV", "--osscan-guess", "-n", ip],
            text=True, timeout=60, stderr=subprocess.DEVNULL
        )
        result: dict = {"ip_address": ip}
        # MAC
        mac_m = re.search(r'MAC Address:\s*([0-9A-F:]+)\s*\((.+?)\)', output, re.IGNORECASE)
        if mac_m:
            result["mac_address"] = mac_m.group(1)
            result["vendor"] = mac_m.group(2).strip()
        # OS
        os_m = re.search(r'OS details?:\s*(.+?)(?:\n|$)', output, re.IGNORECASE)
        if os_m: result["os_type"] = os_m.group(1).strip()[:100]
        else:
            os_m2 = re.search(r'Running:\s*(.+?)(?:\n|$)', output, re.IGNORECASE)
            if os_m2: result["os_type"] = os_m2.group(1).strip()[:100]
        # Hostname
        hn_m = re.search(r'Nmap scan report for\s+(\S+)', output)
        if hn_m and hn_m.group(1) != ip:
            result["hostname"] = hn_m.group(1)
        # Open ports
        ports = re.findall(r'(\d+)/tcp\s+open', output)
        if ports:
            result["open_ports"] = list(map(int, ports))
        return result if len(result) > 1 else None
    except FileNotFoundError: return None
    except Exception as e:
        logger.debug(f"nmap detailed scan failed for {ip}: {e}")
        return None


# ═══════════════════════════════════════════════════════════════════════════
# NetworkScanner
# ═══════════════════════════════════════════════════════════════════════════

class NetworkScanner:
    """Scans networks: ICMP → ARP → SNMP pipeline for device identification."""

    def __init__(
        self,
        snmp_communities: list[str] | None = None,
        concurrency: int = 100,
    ) -> None:
        self.snmp_communities = snmp_communities or ["public"]
        self.concurrency = concurrency or settings.SCAN_CONCURRENCY

    async def scan_async(self, targets: list[str]) -> AsyncIterator[dict]:
        """Scan IP targets. Yields a result for EVERY IP (alive or not)."""
        if not targets: return

        sem = asyncio.Semaphore(self.concurrency)

        async def scan_one(ip: str) -> dict:
            async with sem:
                result = await self._scan_single(ip)
                # Always return a result with at least ip_address and scanned=True
                if result:
                    result["_scanned"] = True
                    return result
                return {"ip_address": ip, "_scanned": True, "_dead": True}

        tasks = [scan_one(ip) for ip in targets]
        for coro in asyncio.as_completed(tasks):
            yield await coro

    async def _scan_single(self, ip: str) -> Optional[dict]:
        """Step 1: ICMP → Step 2: Read ARP → Step 3: DNS → Step 4: SNMP → Step 5: TCP."""
        result = {
            "ip_address": ip,
            "hostname": None, "device_type": None, "vendor": None,
            "mac_address": None, "snmp_available": False, "snmp_community": None,
            "icmp_reachable": False, "discovery_method": "icmp",
            "os_type": None, "open_ports": [],
        }

        # ── Step 1: ICMP ping ──────────────────────────────────────────
        latency = await self._ping(ip)
        if latency is None:
            open_ports = await self._tcp_probe(ip, [22, 80, 443, 161, 3389, 8080, 9090])
            if not open_ports: return None
            result["open_ports"] = open_ports
        else:
            result["icmp_reachable"] = True
            result["latency_ms"] = round(latency, 1)
            result["open_ports"] = await self._tcp_probe(ip, [22, 80, 443, 161, 3389, 8080])

        # ── Step 2: ARP lookup (run AFTER ping to populate cache) ──────
        loop = asyncio.get_event_loop()
        arp_info = await loop.run_in_executor(None, _get_arp_for_ip, ip)
        if arp_info:
            result["mac_address"] = arp_info.get("mac")
            if arp_info.get("vendor"):
                result["vendor"] = arp_info["vendor"]

        # ── Step 3: Hostname (SNMP → DNS → nmap → NetBIOS with sudo) ──
        hostname = None
        # 3a. SNMP sysName
        if result.get("snmp_available") and result.get("hostname"):
            hostname = result.get("hostname")
        # 3b. DNS
        if not hostname:
            try:
                hn = await loop.run_in_executor(None, socket.gethostbyaddr, ip)
                hostname = hn[0]
            except Exception: pass
        # 3c. nmap hostname
        if not hostname:
            try:
                hn_info = await loop.run_in_executor(None, nmap_scan, ip)
                if hn_info and hn_info.get("hostname"):
                    hostname = hn_info["hostname"]
            except Exception: pass
        # 3d. NetBIOS via sudo nmblookup
        if not hostname:
            try:
                nmb_out = subprocess.check_output(
                    ["timeout", "5", "nmblookup", "-A", ip], text=True, timeout=7, stderr=subprocess.DEVNULL
                )
                nmb_m = re.search(r'(\S+)\s+<00>\s+', nmb_out)
                if nmb_m: hostname = nmb_m.group(1)
            except Exception: pass
        # 3e. NetBIOS via nbtscan
        if not hostname:
            try:
                nb_out = subprocess.check_output(
                    ["timeout", "5", "nbtscan", "-q", ip], text=True, timeout=7, stderr=subprocess.DEVNULL
                )
                nb_m = re.search(r'(\S+)', nb_out)
                if nb_m and nb_m.group(1) != ip: hostname = nb_m.group(1)
            except Exception: pass
        # 3f. mDNS (Avahi) for Linux
        if not hostname:
            try:
                av_out = subprocess.check_output(
                    ["timeout", "2", "avahi-resolve-address", ip], text=True, timeout=4, stderr=subprocess.DEVNULL
                )
                av_m = re.search(r'address\s+\S+\s+hostname\s+(\S+)', av_out.replace('\n',' '))
                if not av_m:
                    av_m = re.search(r'(\S+\.local)', av_out)
                if av_m: hostname = av_m.group(1).rstrip('.')
            except Exception: pass
        result["hostname"] = hostname

        # ── Step 4: SNMP (try multiple communities) ────────────────────
        if SNMP_AVAILABLE:
            for community in self.snmp_communities:
                snmp_info = await self._snmp_probe(ip, community)
                if snmp_info:
                    result.update(snmp_info)
                    result["snmp_available"] = True
                    result["snmp_community"] = community
                    result["discovery_method"] = "snmp"
                    # SNMP provides better vendor/type — override ARP guesses
                    if snmp_info.get("vendor"): result["vendor"] = snmp_info["vendor"]
                    if snmp_info.get("device_type"): result["device_type"] = snmp_info["device_type"]
                    if snmp_info.get("os_type"): result["os_type"] = snmp_info["os_type"]
                    break

        # ── Step 5: OS from TCP if SNMP didn't detect ──────────────────
        if not result.get("os_type"):
            result["os_type"] = self._detect_os(result.get("open_ports", []), result.get("hostname", ""))

        # ── Step 6: Device type from ports if still unknown ─────────────
        if not result.get("device_type") or result["device_type"] == "other":
            result["device_type"] = self._guess_type_from_ports(result.get("open_ports", []), result.get("vendor", ""))

        # ── Step 7: nmap fallback (if no useful data collected) ────────
        if not result.get("mac_address") and not result.get("vendor"):
            loop2 = asyncio.get_event_loop()
            nmap_info = await loop2.run_in_executor(None, nmap_scan, ip)
            if nmap_info:
                for k, v in nmap_info.items():
                    if not result.get(k) or result[k] in (None, "", []):
                        result[k] = v

        return result

    async def _ping(self, ip: str) -> float | None:
        """ICMP ping using system ping command (SUID, always works)."""
        loop = asyncio.get_event_loop()
        # Method 1: system ping (SUID root, works for any user)
        try:
            output = await loop.run_in_executor(
                None, lambda: subprocess.check_output(
                    ["sudo", "/usr/bin/ping", "-c", "1", "-W", "2", ip],
                    text=True, timeout=4, stderr=subprocess.DEVNULL
                )
            )
            m = re.search(r'time=([\d.]+)\s*ms', output)
            if m: return float(m.group(1))
            if "1 received" in output or "bytes from" in output: return 0.1
        except Exception: pass
        # Method 2: ping3
        if ping is not None:
            try:
                result = await loop.run_in_executor(None, lambda: ping(ip, timeout=2.0))
                if result is not None and result is not False: return float(result) * 1000
            except Exception: pass
        return None

    async def _tcp_probe(self, ip: str, ports: list[int]) -> list[int]:
        """Check which TCP ports are open. Returns list of open ports."""
        open_ports = []
        for port in ports:
            try:
                _, writer = await asyncio.wait_for(
                    asyncio.open_connection(ip, port), timeout=0.8
                )
                writer.close()
                await writer.wait_closed()
                open_ports.append(port)
            except Exception:
                continue
        return open_ports

    async def _snmp_probe(self, ip: str, community: str) -> Optional[dict]:
        """SNMP system info probe. Returns extended device information.

        Delegates to the unified SNMP service (services/snmp.system_probe).
        """
        return await system_probe(
            ip, community,
            port=settings.SNMP_DEFAULT_PORT,
            os_detector=self._detect_os_from_snmp,
        )

    def _detect_os_from_snmp(self, sys_descr: str) -> str | None:
        """Detect OS type from SNMP sysDescr."""
        d = sys_descr.lower()
        if "cisco ios-xr" in d: return "Cisco IOS-XR"
        if "cisco ios" in d: return "Cisco IOS"
        if "cisco nx-os" in d or "nexus" in d: return "Cisco NX-OS"
        if "cisco adaptive security appliance" in d: return "Cisco ASA"
        if "junos" in d: return "Juniper JunOS"
        if "fortios" in d or "fortigate" in d: return "Fortinet FortiOS"
        if "routeros" in d: return "MikroTik RouterOS"
        if "linux" in d: return "Linux"
        if "ubuntu" in d: return "Ubuntu Linux"
        if "debian" in d: return "Debian Linux"
        if "centos" in d: return "CentOS Linux"
        if "windows" in d: return "Windows"
        if "vmware" in d: return "VMware ESXi"
        if "freebsd" in d: return "FreeBSD"
        if "pfsense" in d: return "pfSense"
        if "opnsense" in d: return "OPNsense"
        if "openwrt" in d: return "OpenWrt"
        if "dd-wrt" in d: return "DD-WRT"
        if "h3c" in d or "comware" in d: return "H3C Comware"
        if "huawei" in d or "vrp" in d: return "Huawei VRP"
        if "aruba" in d: return "ArubaOS"
        if "dell" in d and ("os10" in d or "os9" in d or "ftos" in d):
            return "Dell OS10"
        return None

    def _detect_os(self, ports: list[int], hostname: str) -> str | None:
        """Guess OS from open ports."""
        host_lower = (hostname or "").lower()
        has = lambda p: p in ports
        if has(3389): return "Windows"
        if has(22) and not has(3389):
            if "win" in host_lower: return "Windows"
            return "Linux/Unix"
        if has(80) and has(443) and not has(22) and not has(3389):
            return "Network Appliance (Web)"
        return None

    def _guess_type_from_ports(self, ports: list[int], vendor: str) -> str:
        """Guess device type from open TCP ports."""
        has = lambda p: p in ports
        if has(161) or has(162): return "switch" if vendor in ("Cisco", "HP", "Huawei", "H3C") else "router"
        if has(22) and has(80) and has(443): return "server_linux"
        if has(3389): return "server_windows"
        if has(80) or has(443) or has(8080): return "other"  # web-managed device
        if has(22): return "server_linux"
        return "other"
