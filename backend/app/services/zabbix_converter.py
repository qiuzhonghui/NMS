"""Zabbix 7.0 YAML template converter — parses Zabbix YAML to NMS format.

Handles the full Zabbix 7.0 export format including:
- Monitoring items (with snmp_oid / key mapping)
- Low-level discovery rules (item_prototypes flattened into items)
- Macros, triggers, tags (stored as JSON metadata in description)
- Value maps (stored in description)
"""
import json
from dataclasses import dataclass, field
from typing import Optional

import yaml
from loguru import logger


# ── Intermediate data structures ──────────────────────────────────────────

@dataclass
class ConvertedItem:
    """Single monitoring item ready for TemplateItem insertion."""
    metric_name: str
    metric_type: str       # cpu, memory, disk, network, port, protocol, table, custom
    protocol: str           # snmp, icmp, agent, web
    oid_or_key: str
    data_type: str          # gauge, counter, table, text
    unit: str
    display_type: str       # chart, gauge, text, table
    interval_seconds: int
    enabled: bool = True


@dataclass
class ConvertedTemplate:
    """Parsed Zabbix template ready for import."""
    name: str
    description: str
    vendor: str
    vendor_version: str
    template_groups: list[str] = field(default_factory=list)
    items: list[ConvertedItem] = field(default_factory=list)
    discovery_rules: list[dict] = field(default_factory=list)
    macros: list[dict] = field(default_factory=list)
    triggers: list[dict] = field(default_factory=list)
    tags: list[dict] = field(default_factory=list)
    valuemaps: list[dict] = field(default_factory=list)


# ── Field mapping functions ───────────────────────────────────────────────

def _map_protocol(zabbix_type: str) -> str:
    """Map Zabbix item type to NMS protocol."""
    mapping = {
        "SNMP_AGENT": "snmp",
        "SNMP_TRAP": "snmp",
        "SIMPLE": "agent",          # Zabbix agent passive
        "ZABBIX_ACTIVE": "agent",   # Zabbix agent active
        "INTERNAL": "agent",
        "HTTP_AGENT": "web",
        "ICMP_PING": "icmp",
        "EXTERNAL": "agent",
        "SSH": "agent",
        "TELNET": "agent",
        "IPMI": "snmp",
        "JMX": "agent",
        "CALCULATED": "agent",
        "DEPENDENT": "agent",
    }
    return mapping.get(zabbix_type, "snmp")


def _map_data_type(zabbix_value_type: str) -> str:
    """Map Zabbix value_type to NMS data_type."""
    mapping = {
        "FLOAT": "gauge",
        "UNSIGNED": "gauge",
        "CHAR": "text",
        "TEXT": "text",
        "LOG": "text",
        "BINARY": "text",
    }
    return mapping.get(zabbix_value_type, "gauge")


def _derive_interval(zabbix_history: str) -> int:
    """Convert Zabbix history retention (e.g. '7d', '90d') to poll interval.

    Conservative approach: maps long retention to a reasonable poll interval.
    Default is 60 seconds.
    """
    unit_map = {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800}
    if not zabbix_history:
        return 60
    try:
        value = int(zabbix_history[:-1])
        unit = zabbix_history[-1].lower()
        total_secs = value * unit_map.get(unit, 1)
        # Map retention period to a sensible poll interval
        if total_secs <= 300:
            return 60
        if total_secs <= 3600:
            return 300
        if total_secs <= 86400:
            return 600
        return 900  # long-term items poll every 15 min
    except (ValueError, IndexError):
        return 60


def _derive_metric_type(item_name: str, item_key: str = "") -> str:
    """Classify item into metric_type based on name/keyword heuristics."""
    combined = (item_name + " " + item_key).lower()
    if any(k in combined for k in ["cpu", "processor"]):
        return "cpu"
    if any(k in combined for k in ["mem", "memory", "ram"]):
        return "memory"
    if any(k in combined for k in ["disk", "storage", "fs", "volume", "filesystem"]):
        return "disk"
    if any(k in combined for k in ["net", "if", "interface", "bandwidth", "traffic",
                                     "octet", "packet", "throughput"]):
        return "network"
    if any(k in combined for k in ["port", "tcp", "udp", "connection", "session"]):
        return "port"
    if any(k in combined for k in ["bgp", "ospf", "hsrp", "vrrp", "stp", "lacp",
                                     "routing", "protocol"]):
        return "protocol"
    if any(k in combined for k in ["table", "arp", "route", "fdb", "mac",
                                     "neighbor", "discover"]):
        return "table"
    return "custom"


def _derive_display_type(item_name: str, unit: str = "") -> str:
    """Choose display type based on item characteristics."""
    name_lower = item_name.lower()
    if any(k in name_lower for k in ["status", "state", "alarm", "health"]):
        return "text"
    if unit == "%" or "percent" in name_lower or "usage" in name_lower:
        return "gauge"
    if any(k in name_lower for k in ["table", "list", "top", "discovery"]):
        return "table"
    return "chart"


# ── Item extraction ───────────────────────────────────────────────────────

def _extract_items(zabbix_items: list[dict]) -> list[ConvertedItem]:
    """Convert Zabbix item dicts to ConvertedItem list."""
    result: list[ConvertedItem] = []
    for item in zabbix_items:
        oid = (item.get("snmp_oid") or "").strip()
        key = (item.get("key") or "").strip()

        # Prefer snmp_oid for SNMP items, otherwise use key
        item_type = item.get("type", "SNMP_AGENT")
        if item_type in ("SNMP_AGENT", "SNMP_TRAP") and oid:
            oid_or_key = oid
        elif key:
            oid_or_key = key
        else:
            oid_or_key = oid  # may be empty

        if not oid_or_key:
            logger.debug(f"Skipping Zabbix item '{item.get('name', '?')}' — no OID or key")
            continue

        name = item.get("name", key) or oid_or_key
        unit = (item.get("units") or "").strip()
        history = item.get("history", "")

        result.append(ConvertedItem(
            metric_name=name,
            metric_type=_derive_metric_type(name, key),
            protocol=_map_protocol(item_type),
            oid_or_key=oid_or_key,
            data_type=_map_data_type(item.get("value_type", "FLOAT")),
            unit=unit,
            display_type=_derive_display_type(name, unit),
            interval_seconds=_derive_interval(history),
            enabled=True,
        ))
    return result


def _extract_discovery_items(discovery_rules: list[dict]) -> list[ConvertedItem]:
    """Flatten discovery rule item_prototypes into the main items list.

    Uses naming convention: "{rule_name} - {prototype_name}".
    The {#MACRO} placeholders in OIDs are preserved for future SNMP walk support.
    """
    result: list[ConvertedItem] = []
    for rule in discovery_rules:
        rule_name = rule.get("name", "Discovery")
        prototypes = rule.get("item_prototypes", [])
        for proto in prototypes:
            oid = (proto.get("snmp_oid") or "").strip()
            key = (proto.get("key") or "").strip()
            item_type = proto.get("type", "SNMP_AGENT")
            if item_type in ("SNMP_AGENT", "SNMP_TRAP") and oid:
                oid_or_key = oid
            elif key:
                oid_or_key = key
            else:
                oid_or_key = oid

            if not oid_or_key:
                continue

            proto_name = proto.get("name", key) or oid_or_key
            full_name = f"{rule_name} - {proto_name}"
            unit = (proto.get("units") or "").strip()

            result.append(ConvertedItem(
                metric_name=full_name,
                metric_type=_derive_metric_type(full_name, key),
                protocol=_map_protocol(item_type),
                oid_or_key=oid_or_key,
                data_type=_map_data_type(proto.get("value_type", "FLOAT")),
                unit=unit,
                display_type=_derive_display_type(full_name, unit),
                interval_seconds=_derive_interval(proto.get("history", "")),
                enabled=True,
            ))
    return result


# ── Description building ──────────────────────────────────────────────────

def _build_description(tmpl: dict, converted: "ConvertedTemplate") -> str:
    """Build the description field including original text and Zabbix metadata."""
    parts: list[str] = []

    # Original description
    desc = tmpl.get("description", "")
    if desc:
        parts.append(desc.strip())

    # Vendor info
    vendor_info = tmpl.get("vendor", {})
    if vendor_info.get("name"):
        parts.append(f"\nVendor: {vendor_info['name']} {vendor_info.get('version', '')}".strip())

    # Metadata JSON block
    meta: dict = {}
    if converted.macros:
        meta["macros"] = converted.macros
    if converted.triggers:
        meta["triggers"] = _simplify_triggers(converted.triggers)
    if converted.tags:
        meta["tags"] = converted.tags

    if meta:
        parts.append("\n\n[Zabbix Meta]\n" + json.dumps(meta, indent=2, ensure_ascii=False))

    return "\n".join(parts)


def _simplify_triggers(triggers: list[dict]) -> list[dict]:
    """Extract only key fields from triggers for compact storage."""
    simplified = []
    for t in triggers:
        simplified.append({
            "name": t.get("name", ""),
            "severity": t.get("severity", ""),
            "expression": t.get("expression", "")[:500],
            "description": (t.get("description") or "")[:200],
        })
    return simplified


# ── Main conversion API ───────────────────────────────────────────────────

def parse_zabbix_template(yaml_content: str) -> ConvertedTemplate:
    """Parse a Zabbix 7.0 YAML export into our intermediate form.

    Args:
        yaml_content: Raw YAML string from a Zabbix template export.

    Returns:
        ConvertedTemplate with all items, discovery rules, macros, etc.

    Raises:
        ValueError: If the YAML is invalid or missing required fields.
    """
    try:
        root = yaml.safe_load(yaml_content)
    except yaml.YAMLError as e:
        raise ValueError(f"Invalid YAML: {e}") from e

    if not isinstance(root, dict) or "zabbix_export" not in root:
        raise ValueError("Not a valid Zabbix export: missing 'zabbix_export' key")

    export = root["zabbix_export"]
    templates = export.get("templates", [])
    if not templates:
        raise ValueError("No templates found in Zabbix export")

    tmpl = templates[0]

    # Extract template-level metadata
    vendor_info = tmpl.get("vendor", {})
    groups = [g.get("name", "") for g in tmpl.get("groups", [])]

    # Build the converted template
    converted = ConvertedTemplate(
        name=tmpl.get("template", tmpl.get("name", "Unnamed")),
        vendor=vendor_info.get("name", "Zabbix"),
        vendor_version=vendor_info.get("version", "7.0"),
        template_groups=groups,
        items=[],
        discovery_rules=tmpl.get("discovery_rules", []),
        macros=tmpl.get("macros", []),
        triggers=export.get("triggers", []),
        tags=tmpl.get("tags", []),
        valuemaps=tmpl.get("valuemaps", []),
        description="",
    )

    # Extract items
    zabbix_items = tmpl.get("items", [])
    converted.items = _extract_items(zabbix_items)

    # Flatten discovery rule item prototypes
    discovery_items = _extract_discovery_items(converted.discovery_rules)
    converted.items.extend(discovery_items)

    # Build description with metadata
    converted.description = _build_description(tmpl, converted)

    logger.info(
        f"Converted Zabbix template '{converted.name}': "
        f"{len(zabbix_items)} items + {len(discovery_items)} discovery items, "
        f"{len(converted.macros)} macros, {len(converted.triggers)} triggers"
    )

    return converted


def preview_conversion(yaml_content: str) -> dict:
    """Return a JSON-serializable preview for frontend display.

    Limits to first 50 items to avoid overwhelming the UI.
    """
    ct = parse_zabbix_template(yaml_content)

    def item_to_dict(i: ConvertedItem) -> dict:
        return {
            "metric_name": i.metric_name,
            "metric_type": i.metric_type,
            "protocol": i.protocol,
            "oid_or_key": i.oid_or_key,
            "data_type": i.data_type,
            "unit": i.unit,
            "display_type": i.display_type,
            "interval_seconds": i.interval_seconds,
        }

    all_items = [item_to_dict(i) for i in ct.items]

    return {
        "name": ct.name,
        "description": ct.description[:500],
        "vendor": ct.vendor,
        "vendor_version": ct.vendor_version,
        "template_groups": ct.template_groups,
        "item_count": len(ct.items),
        "discovery_rule_count": len(ct.discovery_rules),
        "trigger_count": len(ct.triggers),
        "macro_count": len(ct.macros),
        "tag_count": len(ct.tags),
        "items": all_items[:50],  # preview: first 50 items
    }
