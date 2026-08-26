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

# ── Read VERSION (regenerate from git if source is a git repo) ─────────────
VER_FILE="$PROJECT_DIR/VERSION"
if [ ! -f "$VER_FILE" ]; then
    echo "ERROR: VERSION file not found. Run: python3 native/gen_version.py"
    exit 1
fi

# Regenerate git-derived VERSION before pushing
if [ -d "$PROJECT_DIR/.git" ] && command -v git &>/dev/null && command -v python3 &>/dev/null; then
    ( cd "$PROJECT_DIR" && python3 native/gen_version.py >/dev/null 2>&1 || true )
fi

VERSION=$(head -1 "$VER_FILE" | tr -d '\r')
echo ""
echo "=== NMS Push v$VERSION ==="
echo "Target: $TARGET:$TARGET_PATH"
echo ""

# ── Find changed files (git-driven; manifest fallback without git) ─────────
CHANGED=()
if [ -d "$PROJECT_DIR/.git" ] && command -v git &>/dev/null; then
    # Committed changes since the most recent tag
    BASE_REF=$(cd "$PROJECT_DIR" && git describe --tags --abbrev=0 2>/dev/null || true)
    if [ -n "$BASE_REF" ]; then
        while IFS= read -r f; do
            [ -n "$f" ] && CHANGED+=("$f")
        done < <(cd "$PROJECT_DIR" && git diff --name-only "$BASE_REF" -- backend frontend native)
    fi
    # Uncommitted working-tree changes
    while IFS= read -r f; do
        [ -n "$f" ] && CHANGED+=("$f")
    done < <(cd "$PROJECT_DIR" && git status --porcelain -- backend frontend native | sed 's/^...//')
else
    # No git: push every file present in the manifest
    while IFS= read -r line; do
        [[ "$line" =~ ^[0-9a-f]{32}\  ]] && CHANGED+=("${line:34}")
    done < "$VER_FILE"
fi

# Deduplicate and exclude VERSION (uploaded separately)
CHANGED=($(printf "%s\n" "${CHANGED[@]}" | grep -v "^VERSION$" | sort -u))

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
