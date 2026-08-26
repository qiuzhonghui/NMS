#!/usr/bin/env python3
"""
Generate VERSION file with git-derived version + MD5 checksums.

Version source (priority):
  1. git tag           -> v1.2.89        -> "1.2.89"
  2. tag + N commits   -> v1.2.89-3-gabc -> "1.2.89.dev3"
  3. no tag            -> git rev-list --count HEAD -> "0.0.<count>"
  4. no git            -> manual patch bump (legacy fallback)

Tracked files are auto-discovered via `git ls-files` so the manifest always
matches the repository (no manual list to keep in sync).

Run this BEFORE deploying (on the source machine):
    python3 native/gen_version.py
"""
import hashlib
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Files that must NOT appear in the manifest:
# - VERSION itself (self-MD5 impossible to get right)
# - gen_version.py itself (its own MD5 changes on every edit)
# - .gitignore / repo-internal files not deployed
MANIFEST_EXCLUDE = {
    "VERSION",
    "native/gen_version.py",
    ".gitignore",
}

# Fallback manifest when git is unavailable (source not in a git repo).
# Keep in sync with the deployed file set.
TRACKED_FALLBACK = [
    "backend/app/main.py",
    "backend/app/config.py",
    "backend/app/database.py",
    "backend/app/__init__.py",
    "backend/app/models/__init__.py",
    "backend/app/models/device.py",
    "backend/app/models/device_template.py",
    "backend/app/models/dashboard.py",
    "backend/app/models/web_scraper.py",
    "backend/app/models/metrics.py",
    "backend/app/models/topology.py",
    "backend/app/models/rack.py",
    "backend/app/models/front_panel.py",
    "backend/app/models/alert.py",
    "backend/app/routers/__init__.py",
    "backend/app/routers/discovery.py",
    "backend/app/routers/devices.py",
    "backend/app/routers/device_models.py",
    "backend/app/routers/dashboards.py",
    "backend/app/routers/metrics.py",
    "backend/app/routers/topology.py",
    "backend/app/routers/racks.py",
    "backend/app/routers/front_panels.py",
    "backend/app/routers/alerts.py",
    "backend/app/routers/snmp_templates.py",
    "backend/app/routers/zabbix_templates.py",
    "backend/app/routers/mib_manager.py",
    "backend/app/routers/ai_settings.py",
    "backend/app/services/__init__.py",
    "backend/app/services/scanner.py",
    "backend/app/services/snmp.py",
    "backend/app/services/snmp_collector.py",
    "backend/app/services/zabbix_converter.py",
    "backend/app/services/zabbix_repo.py",
    "backend/app/services/icmp_monitor.py",
    "backend/app/services/topology_discovery.py",
    "backend/app/services/alert_engine.py",
    "backend/app/utils/__init__.py",
    "backend/app/utils/cidr.py",
    "backend/app/utils/snmp_helpers.py",
    "backend/app/utils/snmp_profiles.py",
    "backend/app/utils/mib_parser.py",
    "backend/app/websocket/__init__.py",
    "backend/app/websocket/manager.py",
    "backend/requirements.txt",
    "frontend/index.html",
    "frontend/js/app.js",
    "frontend/js/api.js",
    "frontend/js/websocket.js",
    "frontend/js/i18n.js",
    "frontend/js/utils/format.js",
    "frontend/js/utils/constants.js",
    "frontend/js/utils/table-resize.js",
    "frontend/js/components/context-menu.js",
    "frontend/js/components/front-panel.js",
    "frontend/js/components/rack-view.js",
    "frontend/js/pages/dashboard.js",
    "frontend/js/pages/discovery.js",
    "frontend/js/pages/devices.js",
    "frontend/js/pages/device-detail.js",
    "frontend/js/pages/device-models.js",
    "frontend/js/pages/device-types.js",
    "frontend/js/pages/add-device.js",
    "frontend/js/pages/topology.js",
    "frontend/js/pages/racks.js",
    "frontend/js/pages/alerts.js",
    "frontend/js/pages/snmp-templates.js",
    "frontend/js/pages/zabbix-templates.js",
    "frontend/js/pages/mib-manager.js",
    "frontend/js/pages/settings-page.js",
    "frontend/css/main.css",
    "frontend/css/dashboard.css",
    "frontend/css/discovery.css",
    "frontend/css/topology.css",
    "frontend/css/rack.css",
    "native/nms.sh",
    "native/nms.service",
    "native/init_db.sql",
    "native/nginx.conf",
]


def _md5_file(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def _git(*args) -> str | None:
    try:
        return subprocess.check_output(
            ["git", *args], cwd=str(ROOT), stderr=subprocess.DEVNULL
        ).decode("utf-8", errors="replace").strip()
    except Exception:
        return None


def git_derived_version() -> str | None:
    """Derive a version number from git (tag / commits)."""
    desc = _git("describe", "--tags", "--always")
    if not desc:
        return None
    m = re.match(r"^v?(\d+)\.(\d+)\.(\d+)", desc)
    if m:
        base = f"{m.group(1)}.{m.group(2)}.{m.group(3)}"
        tail = desc[m.end():]
        if not tail:
            return base  # exactly on a tag
        n = re.match(r"^-(\d+)", tail)
        if n:
            return f"{base}.dev{n.group(1)}"  # N commits after tag
    # No tag at all: use commit count as patch
    count = _git("rev-list", "--count", "HEAD")
    if count and count.isdigit():
        return f"0.0.{count}"
    return None


def tracked_files() -> list[str] | None:
    """git ls-files -> manifest file list (None if git unavailable).

    Only deployment-relevant paths are included so the manifest doubles as the
    deploy checklist (backend / frontend / native / VERSION).
    """
    out = _git("ls-files")
    if out is None:
        return None
    files = [f for f in out.split("\n") if f.strip()]
    deploy = [f for f in files if f not in MANIFEST_EXCLUDE]
    return [f for f in deploy if f.startswith(("backend/", "frontend/", "native/", "VERSION"))]


def manual_bump(old_ver: str) -> str:
    """Legacy fallback: increment patch (rolls over to minor)."""
    parts = old_ver.split(".")
    major, minor, patch = int(parts[0]), int(parts[1]), int(parts[2]) + 1
    if patch > 99:
        minor += 1
        patch = 0
    return f"{major}.{minor}.{patch}"


def update_index_cache_buster(new_ver: str) -> None:
    """Rewrite every ?v=... in index.html to the new version (cache buster)."""
    html_path = ROOT / "frontend" / "index.html"
    if not html_path.exists():
        return
    html = html_path.read_text(encoding="utf-8")
    html = re.sub(r'\?v=[\w.-]+"', f'?v={new_ver}"', html)
    html_path.write_text(html, encoding="utf-8")


def main():
    ver_path = ROOT / "VERSION"
    old_ver = "0.0.0"
    if ver_path.exists():
        first = ver_path.read_text(encoding="utf-8").strip().split("\n")[0].strip()
        if first:
            old_ver = first

    new_ver = git_derived_version()
    source = "git"
    if new_ver is None:
        new_ver = manual_bump(old_ver)
        source = "manual-bump (no git)"

    # Update index.html cache buster BEFORE computing MD5s
    update_index_cache_buster(new_ver)

    files = tracked_files()
    if files is None:
        files = TRACKED_FALLBACK

    lines = [new_ver, "# GENERATED BY gen_version.py — DO NOT EDIT", f"# Source: {source}", "# Files:"]
    missing = []
    ok = 0
    for f in sorted(files):
        p = ROOT / f
        if p.exists():
            lines.append(f"{_md5_file(p)}  {f}")
            ok += 1
        else:
            lines.append(f"MISSING  {f}")
            missing.append(f)

    ver_path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    msg = f"VERSION {new_ver} ({source}) - {ok} files hashed"
    if missing:
        msg += f", {len(missing)} MISSING: {missing}"
    else:
        msg += " [OK]"
    print(msg)


if __name__ == "__main__":
    main()
