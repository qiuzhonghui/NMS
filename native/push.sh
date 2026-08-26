#!/usr/bin/env bash
# =============================================================================
# NMS Push Script — uploads changed files to server based on VERSION manifest.
# Run this locally after making code changes.
# Usage: bash native/push.sh [server] [path]
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$HOME/.nms_deploy_target"

# ── Load saved target ───────────────────────────────────────────────────────
TARGET=""
TARGET_PATH=""

if [ -f "$CONFIG_FILE" ]; then
    TARGET=$(grep "^server=" "$CONFIG_FILE" 2>/dev/null | cut -d= -f2- | xargs)
    TARGET_PATH=$(grep "^path=" "$CONFIG_FILE" 2>/dev/null | cut -d= -f2- | xargs)
fi

# ── Args override ────────────────────────────────────────────────────────────
if [ $# -ge 1 ]; then TARGET="$1"; fi
if [ $# -ge 2 ]; then TARGET_PATH="$2"; fi

# ── Prompt if missing ────────────────────────────────────────────────────────
if [ -z "$TARGET" ]; then
    read -rp "Server (e.g. root@10.0.0.42): " TARGET
fi
if [ -z "$TARGET_PATH" ]; then
    read -rp "Remote path (e.g. /root/NMS): " TARGET_PATH
fi

# Save config
mkdir -p "$(dirname "$CONFIG_FILE")"
echo "server=$TARGET" > "$CONFIG_FILE"
echo "path=$TARGET_PATH" >> "$CONFIG_FILE"
echo "Auto-saving to $CONFIG_FILE"

# ── Read VERSION ─────────────────────────────────────────────────────────────
VER_FILE="$PROJECT_DIR/VERSION"
if [ ! -f "$VER_FILE" ]; then
    echo "ERROR: VERSION file not found. Run: python3 native/gen_version.py"
    exit 1
fi

VERSION=$(head -1 "$VER_FILE" | tr -d '\r')
echo ""
echo "=== NMS Push v$VERSION ==="
echo "Target: $TARGET:$TARGET_PATH"
echo ""

# ── Find changed files ───────────────────────────────────────────────────────
CHANGED=()
while IFS= read -r line; do
    if [[ "$line" =~ ^[0-9a-f]{32}\ [0-9a-f]{32}\  ]]; then
        cur="${line:0:32}"
        prev="${line:33:32}"
        fpath="${line:66}"
        if [ "$cur" != "$prev" ] || [ "$prev" = "new" ]; then
            src="$PROJECT_DIR/$fpath"
            if [ -f "$src" ]; then
                actual=$(md5sum "$src" 2>/dev/null | awk '{print $1}')
                if [ "$actual" = "$cur" ]; then
                    CHANGED+=("$fpath")
                fi
            fi
        fi
    fi
done < "$VER_FILE"

if [ ${#CHANGED[@]} -eq 0 ]; then
    echo "No changed files. Nothing to push."
    exit 0
fi

echo "${#CHANGED[@]} files to upload:"
for f in "${CHANGED[@]}"; do echo "  $f"; done
echo ""

# ── Upload ────────────────────────────────────────────────────────────────────
UPLOADED=0
for f in "${CHANGED[@]}"; do
    src="$PROJECT_DIR/$f"
    dst="$TARGET:$TARGET_PATH/$f"
    echo -n "  Uploading $f ... "
    if scp -q "$src" "$dst" 2>/dev/null; then
        echo "OK"
        ((UPLOADED++))
    else
        echo "FAILED"
    fi
done

echo ""
echo "Uploaded $UPLOADED/${#CHANGED[@]} files."

# ── Upload VERSION too ────────────────────────────────────────────────────────
echo -n "Uploading VERSION ... "
scp -q "$VER_FILE" "$TARGET:$TARGET_PATH/VERSION" 2>/dev/null && echo "OK" || echo "FAILED"

# ── Run update on server ──────────────────────────────────────────────────────
echo ""
read -rp "Run 'nms.sh update' on server now? [Y/n]: " DO_UPDATE
if [ "$DO_UPDATE" != "n" ] && [ "$DO_UPDATE" != "N" ]; then
    echo "Running update..."
    ssh "$TARGET" "cd $TARGET_PATH && sudo bash native/nms.sh update"
fi

echo ""
echo "Done."
