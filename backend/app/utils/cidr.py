"""CIDR and IP range parsing utilities for network discovery."""
import ipaddress
import re


def parse_network_ranges(ranges: list[str]) -> list[str]:
    """Parse a list of network range strings into individual IP addresses.

    Supports:
        - CIDR notation: "192.168.1.0/24"
        - Range notation: "192.168.1.1-192.168.1.50"
        - Short range: "192.168.1.0-200" (same subnet)
        - Single IP: "10.0.0.1"

    Returns a deduplicated list of IP address strings.
    """
    all_ips: list[str] = []

    # Precompiled once: "192.168.1.1-50" or "192.168.1.1-192.168.1.50"
    range_pattern = re.compile(
        r"^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)?(\d{1,3})\s*-\s*(\d{1,3}(?:\.\d{1,3}(?:\.\d{1,3}(?:\.\d{1,3})?)?)?)$"
    )

    for entry in ranges:
        entry = entry.strip()
        if not entry:
            continue

        # Try CIDR notation
        if "/" in entry and "-" not in entry:
            try:
                net = ipaddress.ip_network(entry, strict=False)
                for host_ip in net.hosts():
                    all_ips.append(str(host_ip))
                # Include network and broadcast for /31 and smaller
                if net.prefixlen >= 31:
                    for net_ip in net:
                        all_ips.append(str(net_ip))
                continue
            except ValueError:
                pass

        # Try range notation: "192.168.1.1-50" or "192.168.1.1-192.168.1.50"
        m = range_pattern.match(entry)
        if m:
            prefix = m.group(1) or ""
            start_str = m.group(2)
            end_str = m.group(3)

            # Determine the full base: use first 3 octets from prefix + start if applicable
            if "." in end_str:
                # Full IP range like "192.168.1.1-192.168.1.50"
                start_ip = _to_ip(prefix + start_str) if prefix else _to_ip(start_str)
                end_ip = _to_ip(end_str)
            else:
                # Short range like "192.168.1.1-50"
                start_ip = _to_ip(prefix + start_str) if prefix else _to_ip(start_str)
                # end is just the last octet
                parts = start_str.split(".")
                if prefix:
                    base = prefix.rstrip(".")
                else:
                    base = ".".join(parts[:3])
                end_ip = _to_ip(f"{base}.{end_str}")

            if start_ip and end_ip:
                start_int = int(start_ip)
                end_int = int(end_ip)
                if start_int > end_int:
                    start_int, end_int = end_int, start_int
                for ip_int in range(start_int, end_int + 1):
                    all_ips.append(str(ipaddress.IPv4Address(ip_int)))
                continue

        # Try single IP
        try:
            single = ipaddress.IPv4Address(entry)
            all_ips.append(str(single))
        except ipaddress.AddressValueError:
            continue

    # Deduplicate while preserving order
    seen = set()
    result = []
    for addr in all_ips:
        if addr not in seen:
            seen.add(addr)
            result.append(addr)
    return result


def _to_ip(s: str) -> ipaddress.IPv4Address | None:
    """Convert string to IPv4Address, returning None on failure."""
    try:
        return ipaddress.IPv4Address(s)
    except ipaddress.AddressValueError:
        return None
