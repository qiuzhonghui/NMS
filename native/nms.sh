#!/usr/bin/env bash
# =============================================================================
# NMS - Network Management System
# All-in-One Management Script (Install / Uninstall / Upgrade / Status)
# =============================================================================
# Usage:
#   sudo bash nms.sh              # Interactive menu
#   sudo bash nms.sh install      # Direct install
#   sudo bash nms.sh uninstall    # Direct uninstall
#   sudo bash nms.sh upgrade      # Direct upgrade
#   sudo bash nms.sh status       # Show status
# =============================================================================
set -uo pipefail

# ── Color output ────────────────────────────────────────────────────────────
C_RESET='\033[0m'; C_RED='\033[0;31m'; C_GREEN='\033[0;32m'
C_YELLOW='\033[1;33m'; C_BLUE='\033[0;34m'; C_CYAN='\033[0;36m'; C_BOLD='\033[1m'

info()  { echo -e "  ${C_GREEN}[OK]${C_RESET}  $*"; }
warn()  { echo -e "  ${C_YELLOW}[!!]${C_RESET}  $*"; }
error() { echo -e "  ${C_RED}[XX]${C_RESET}  $*"; }
step()  { echo -e "\n${C_CYAN}${C_BOLD}==> $*${C_RESET}\n"; }
die()   { echo -e "\n${C_RED}${C_BOLD}FATAL: $*${C_RESET}\n"; exit 1; }

# ── Defaults ────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

INSTALL_DIR="/opt/nms"
NMS_USER="nms"
NMS_PORT=8000
DB_HOST="127.0.0.1"
DB_PORT=3306
DB_NAME="nms"
DB_USER="nms"
DB_PASSWORD=""
MYSQL_ROOT_PASSWORD=""

# Auto-detect MySQL auth
MYSQL_CMD=""
MYSQL_ADMIN_CMD=""

# Version file
VERSION_FILE="${INSTALL_DIR}/.version"
CURRENT_VERSION="$(head -1 "${SCRIPT_DIR}/../VERSION" 2>/dev/null | tr -d '\r' || echo '1.0.0')"

# ── Banner ───────────────────────────────────────────────────────────────────
banner() {
    echo -e "${C_BLUE}${C_BOLD}"
    echo "╔══════════════════════════════════════════════════════╗"
    echo "║     NMS - Network Management System                  ║"
    echo "║     Management Script v${CURRENT_VERSION}                            ║"
    echo "╚══════════════════════════════════════════════════════╝"
    echo -e "${C_RESET}"
}

# ═════════════════════════════════════════════════════════════════════════════
# UTILITY FUNCTIONS
# ═════════════════════════════════════════════════════════════════════════════

check_root() {
    if [[ $EUID -ne 0 ]]; then
        die "This script must be run as root. Use: sudo bash nms.sh"
    fi
}

# Detect the best way to connect to MySQL as admin
detect_mysql_auth() {
    step "Detecting MySQL authentication method..."

    # Ensure MySQL is running first
    if ! systemctl is-active --quiet mysql 2>/dev/null && \
       ! systemctl is-active --quiet mysqld 2>/dev/null && \
       ! systemctl is-active --quiet mariadb 2>/dev/null; then
        warn "MySQL server is not running"
        MYSQL_CMD=""
        MYSQL_ADMIN_CMD=""
        return 1
    fi

    # Try socket auth (Debian/Ubuntu default): sudo mysql
    if sudo mysql -e "SELECT 1" &>/dev/null 2>&1; then
        MYSQL_ADMIN_CMD="sudo mysql"
        MYSQL_CMD="sudo mysql"
        info "MySQL auth: socket (sudo mysql)"
        return 0
    fi

    # Try root with no password
    if mysql -uroot -e "SELECT 1" &>/dev/null 2>&1; then
        MYSQL_ADMIN_CMD="mysql -uroot"
        MYSQL_CMD="mysql -uroot"
        info "MySQL auth: root without password"
        return 0
    fi

    # Try with provided password
    if [ -n "$MYSQL_ROOT_PASSWORD" ]; then
        if mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" -e "SELECT 1" &>/dev/null 2>&1; then
            MYSQL_ADMIN_CMD="mysql -uroot -p${MYSQL_ROOT_PASSWORD}"
            MYSQL_CMD="mysql -uroot -p${MYSQL_ROOT_PASSWORD}"
            info "MySQL auth: root with password"
            return 0
        fi
    fi

    # Can't connect
    warn "Cannot connect to MySQL as root"
    warn "Tried: sudo mysql, mysql -uroot, mysql -uroot -p"
    MYSQL_CMD=""
    MYSQL_ADMIN_CMD=""
    return 1
}

# Execute a SQL statement as admin
mysql_exec() {
    local sql="$1"
    if [ -z "$MYSQL_ADMIN_CMD" ]; then
        error "MySQL admin connection not available"
        return 1
    fi
    $MYSQL_ADMIN_CMD -e "$sql" 2>&1
}

# ═════════════════════════════════════════════════════════════════════════════
# STEP VALIDATION HELPERS
# ═════════════════════════════════════════════════════════════════════════════

check_step() {
    local desc="$1"; shift
    if "$@"; then
        info "$desc"
        return 0
    else
        error "$desc"
        return 1
    fi
}

# ═════════════════════════════════════════════════════════════════════════════
# STATUS
# ═════════════════════════════════════════════════════════════════════════════

do_status() {
    banner
    echo ""
    echo -e "${C_BOLD}── NMS System Status ──${C_RESET}"
    echo ""

    # 1. Installation
    if [ -f "${INSTALL_DIR}/.env" ]; then
        echo -e "  Install directory: ${C_GREEN}${INSTALL_DIR}${C_RESET}"
        if [ -f "$VERSION_FILE" ]; then
            echo -e "  Installed version:  ${C_GREEN}$(cat $VERSION_FILE)${C_RESET}"
        fi
    else
        echo -e "  Install directory: ${C_RED}NOT INSTALLED${C_RESET}"
    fi

    # 2. Service
    if systemctl is-active --quiet nms 2>/dev/null; then
        echo -e "  NMS service:        ${C_GREEN}RUNNING${C_RESET}"
    elif systemctl is-enabled nms &>/dev/null 2>&1; then
        echo -e "  NMS service:        ${C_YELLOW}STOPPED (enabled)${C_RESET}"
    else
        echo -e "  NMS service:        ${C_RED}NOT CONFIGURED${C_RESET}"
    fi

    # 3. Port
    if ss -tlnp | grep -q ":${NMS_PORT}"; then
        echo -e "  Port ${NMS_PORT}:          ${C_GREEN}LISTENING${C_RESET}"
    else
        echo -e "  Port ${NMS_PORT}:          ${C_YELLOW}NOT LISTENING${C_RESET}"
    fi

    # 4. MySQL
    if systemctl is-active --quiet mysql 2>/dev/null || \
       systemctl is-active --quiet mysqld 2>/dev/null || \
       systemctl is-active --quiet mariadb 2>/dev/null; then
        echo -e "  MySQL service:      ${C_GREEN}RUNNING${C_RESET}"

        # Test DB connection
        if [ -f "${INSTALL_DIR}/.env" ]; then
            source "${INSTALL_DIR}/.env"
            if mysql -u"${DB_USER}" -p"${DB_PASSWORD}" -h"${DB_HOST}" "${DB_NAME}" -e "SELECT 1" &>/dev/null 2>&1; then
                local table_count=$(mysql -u"${DB_USER}" -p"${DB_PASSWORD}" -h"${DB_HOST}" "${DB_NAME}" -e "SHOW TABLES;" -s 2>/dev/null | wc -l)
                echo -e "  Database '${DB_NAME}':  ${C_GREEN}CONNECTED${C_RESET} (${table_count} tables)"
            else
                echo -e "  Database '${DB_NAME}':  ${C_RED}CANNOT CONNECT${C_RESET}"
            fi
        fi
    else
        echo -e "  MySQL service:      ${C_RED}NOT RUNNING${C_RESET}"
    fi

    # 5. Python venv
    if [ -f "${INSTALL_DIR}/venv/bin/python" ]; then
        local py_ver=$("${INSTALL_DIR}/venv/bin/python" --version 2>&1)
        echo -e "  Python venv:        ${C_GREEN}${py_ver}${C_RESET}"
    else
        echo -e "  Python venv:        ${C_YELLOW}NOT FOUND${C_RESET}"
    fi

    # 6. Web check
    if command -v curl &>/dev/null; then
        local http_code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${NMS_PORT}/api/health" 2>/dev/null || echo "000")
        if [ "$http_code" = "200" ]; then
            echo -e "  Health check:       ${C_GREEN}HTTP 200 OK${C_RESET}"
        else
            echo -e "  Health check:       ${C_YELLOW}HTTP ${http_code}${C_RESET}"
        fi
    fi

    echo ""
}

# ═════════════════════════════════════════════════════════════════════════════
# INSTALL
# ═════════════════════════════════════════════════════════════════════════════

do_install() {
    banner
    check_root

    echo ""
    echo -e "${C_YELLOW}${C_BOLD}Starting NMS Installation...${C_RESET}"
    echo -e "  Install dir: ${C_BOLD}${INSTALL_DIR}${C_RESET}"
    echo -e "  Port:        ${C_BOLD}${NMS_PORT}${C_RESET}"
    echo -e "  Database:    ${C_BOLD}${DB_HOST}:${DB_PORT}/${DB_NAME}${C_RESET}"
    echo ""
    read -rp "  Continue? [Y/n]: " CONFIRM
    if [ "$CONFIRM" = "n" ] || [ "$CONFIRM" = "N" ]; then
        echo "Aborted."
        exit 0
    fi

    # ── Step 1: System dependencies ─────────────────────────────────────
    step "Step 1/8  Installing system packages..."
    if ! command -v python3 &>/dev/null || ! command -v pip3 &>/dev/null; then
        apt-get update -y -qq
        apt-get install -y -qq python3 python3-pip python3-venv python3-dev \
            gcc libffi-dev libssl-dev curl wget net-tools nmap nbtscan samba-common-bin avahi-utils 2>&1 | tail -3
    else
        info "Python3 already installed: $(python3 --version)"
    fi
    check_step "Python3 available" command -v python3 &>/dev/null || die "Failed to install Python3"

    # ── Step 2: MySQL / MariaDB ─────────────────────────────────────────
    step "Step 2/8  Setting up database server..."

    MYSQL_SERVICE=""
    if systemctl is-active --quiet mysql 2>/dev/null; then MYSQL_SERVICE="mysql"; fi
    if systemctl is-active --quiet mysqld 2>/dev/null; then MYSQL_SERVICE="mysqld"; fi
    if systemctl is-active --quiet mariadb 2>/dev/null; then MYSQL_SERVICE="mariadb"; fi

    if [ -z "$MYSQL_SERVICE" ]; then
        warn "No database server running. Detecting available packages..."

        # Debian 13+ only has mariadb-server; older Debian/Ubuntu may have both
        DB_PKG=""
        if apt-cache show mariadb-server &>/dev/null 2>&1; then
            DB_PKG="mariadb-server"
            MYSQL_SERVICE="mariadb"
            info "Found: mariadb-server"
        elif apt-cache show mysql-server &>/dev/null 2>&1; then
            DB_PKG="mysql-server"
            MYSQL_SERVICE="mysql"
            info "Found: mysql-server"
        elif apt-cache show default-mysql-server &>/dev/null 2>&1; then
            DB_PKG="default-mysql-server"
            MYSQL_SERVICE="mysql"
            info "Found: default-mysql-server"
        fi

        if [ -z "$DB_PKG" ]; then
            die "No MySQL/MariaDB package available. Install manually: apt install mariadb-server"
        fi

        echo "  Installing ${DB_PKG}..."
        apt-get install -y -qq ${DB_PKG} 2>&1 | tail -5

        # Start the service
        systemctl enable ${MYSQL_SERVICE} --now 2>/dev/null || \
            systemctl enable mysql --now 2>/dev/null || \
            systemctl enable mysqld --now 2>/dev/null

        # Re-detect actual running service name
        MYSQL_SERVICE=""
        if systemctl is-active --quiet mariadb 2>/dev/null; then MYSQL_SERVICE="mariadb"; fi
        if systemctl is-active --quiet mysql 2>/dev/null; then MYSQL_SERVICE="mysql"; fi
        if systemctl is-active --quiet mysqld 2>/dev/null; then MYSQL_SERVICE="mysqld"; fi

        if [ -z "$MYSQL_SERVICE" ]; then
            echo ""
            error "Database service failed to start. Check logs:"
            journalctl -u mariadb --no-pager -n 10 2>/dev/null || true
            journalctl -u mysql --no-pager -n 10 2>/dev/null || true
            die "Cannot start database server."
        fi
        check_step "Database server installed and running (${MYSQL_SERVICE})" true
    else
        info "Database server already running (${MYSQL_SERVICE})"
    fi

    # Detect auth
    if ! detect_mysql_auth; then
        echo ""
        warn "Cannot auto-connect to MySQL."
        warn "This is normal on Debian — 'sudo mysql' should work."
        echo ""
        read -rp "  Enter MySQL root password (or blank to try sudo): " MYSQL_ROOT_PASSWORD
        detect_mysql_auth || die "Still cannot connect to MySQL. Please check MySQL installation."
    fi
    check_step "MySQL connection" test -n "$MYSQL_ADMIN_CMD" || die "No MySQL admin connection"

    # ── Step 3: Create database ─────────────────────────────────────────
    step "Step 3/8  Creating database and user..."

    DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -base64 18 | tr -dc 'a-zA-Z0-9' | head -c20)}"

    # Detect MariaDB vs MySQL for compatible SQL syntax
    DB_VERSION=$($MYSQL_ADMIN_CMD -N -e "SELECT VERSION();" 2>/dev/null)
    IS_MARIADB=false
    if echo "$DB_VERSION" | grep -iq "mariadb"; then
        IS_MARIADB=true
        info "Detected: MariaDB ${DB_VERSION}"
    else
        info "Detected: MySQL ${DB_VERSION}"
    fi

    # Create database
    mysql_exec "CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    check_step "Database '${DB_NAME}' created" true

    # Drop existing users first (to ensure clean creation)
    mysql_exec "DROP USER IF EXISTS '${DB_USER}'@'localhost';" 2>/dev/null
    mysql_exec "DROP USER IF EXISTS '${DB_USER}'@'127.0.0.1';" 2>/dev/null
    mysql_exec "DROP USER IF EXISTS '${DB_USER}'@'%';" 2>/dev/null

    # Create users — use IDENTIFIED BY only (compatible with both MySQL and MariaDB)
    for host in "localhost" "127.0.0.1" "%"; do
        if $IS_MARIADB; then
            mysql_exec "CREATE USER '${DB_USER}'@'${host}' IDENTIFIED BY '${DB_PASSWORD}';"
        else
            mysql_exec "CREATE USER '${DB_USER}'@'${host}' IDENTIFIED BY '${DB_PASSWORD}';"
            # On MySQL 8.0, force mysql_native_password for aiomysql compatibility
            mysql_exec "ALTER USER '${DB_USER}'@'${host}' IDENTIFIED WITH mysql_native_password BY '${DB_PASSWORD}';" 2>/dev/null || true
        fi
        mysql_exec "GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'${host}';"
    done
    mysql_exec "FLUSH PRIVILEGES;"
    check_step "User '${DB_USER}' created" true

    # Check bind address
    BIND_ADDR=$(mysql_exec "SHOW VARIABLES LIKE 'bind_address';" 2>/dev/null | grep bind_address | awk '{print $2}' || echo "unknown")
    info "DB bind_address = ${BIND_ADDR}"

    # Verify connection — try multiple methods
    CONN_OK=false
    echo -n "  Verifying connection..."

    # Try TCP 127.0.0.1
    if mysql -u"${DB_USER}" -p"${DB_PASSWORD}" -h127.0.0.1 "${DB_NAME}" -e "SELECT 1" &>/dev/null 2>&1; then
        echo -e " ${C_GREEN}TCP OK${C_RESET}"
        CONN_OK=true
    # Try socket
    elif mysql -u"${DB_USER}" -p"${DB_PASSWORD}" "${DB_NAME}" -e "SELECT 1" &>/dev/null 2>&1; then
        echo -e " ${C_GREEN}socket OK${C_RESET}"
        CONN_OK=true
        DB_HOST="localhost"
        warn "Only socket connection works. Set DB_HOST=localhost in .env"
    fi

    if [ "$CONN_OK" = true ]; then
        info "Database connection verified (${DB_USER}@${DB_HOST}/${DB_NAME})"
    else
        error "Connection failed. Diagnosing..."
        echo ""
        mysql_exec "SELECT user, host, plugin FROM mysql.user WHERE user='${DB_USER}';" 2>/dev/null || true
        echo ""
        echo "  Manual test: mysql -u${DB_USER} -p${DB_PASSWORD} -h127.0.0.1 ${DB_NAME} -e 'SELECT 1'"
        echo ""
        die "Cannot connect. Check: MySQL bind-address = 127.0.0.1 or 0.0.0.0, and port 3306 is listening."
    fi

    # ── Step 4: Create system user ──────────────────────────────────────
    step "Step 4/8  Creating system user..."
    if ! id -u "$NMS_USER" &>/dev/null 2>&1; then
        useradd -r -m -d "$INSTALL_DIR" -s /usr/sbin/nologin "$NMS_USER"
        info "User '${NMS_USER}' created"
    else
        info "User '${NMS_USER}' already exists"
    fi
    check_step "System user ready" id -u "$NMS_USER" &>/dev/null

    # ── Step 5: Deploy files ────────────────────────────────────────────
    step "Step 5/8  Deploying application files..."
    mkdir -p "$INSTALL_DIR"
    cp -r "${PROJECT_DIR}/backend" "$INSTALL_DIR/"
    cp -r "${PROJECT_DIR}/frontend" "$INSTALL_DIR/"
    cp "${PROJECT_DIR}/VERSION" "$INSTALL_DIR/"
    check_step "Backend files deployed" test -f "${INSTALL_DIR}/backend/app/main.py"
    check_step "Frontend files deployed" test -f "${INSTALL_DIR}/frontend/index.html"

    # Strip CR line endings from deployed files
    _strip_cr "$INSTALL_DIR"

    # ── Step 6: Python venv + dependencies ──────────────────────────────
    step "Step 6/8  Setting up Python environment..."

    if [ ! -d "${INSTALL_DIR}/venv" ]; then
        python3 -m venv "${INSTALL_DIR}/venv"
    fi
    check_step "Virtual environment created" test -f "${INSTALL_DIR}/venv/bin/python"

    # ── PyPI mirror selection ─────────────────────────────────────────
    # Try default PyPI first, fall back to Chinese mirrors if unreachable
    PIP="${INSTALL_DIR}/venv/bin/pip"
    PIP_INSTALL_OPTS="--default-timeout=120"

    MIRRORS=(
        "default|https://pypi.org/simple/"
        "tsinghua|https://pypi.tuna.tsinghua.edu.cn/simple/"
        "aliyun|https://mirrors.aliyun.com/pypi/simple/"
        "ustc|https://pypi.mirrors.ustc.edu.cn/simple/"
        "tencent|https://mirrors.cloud.tencent.com/pypi/simple/"
        "huawei|https://repo.huaweicloud.com/repository/pypi/simple/"
    )

    USE_MIRROR=""
    MIRROR_NAME=""

    for entry in "${MIRRORS[@]}"; do
        name="${entry%%|*}"
        url="${entry##*|}"
        if [ "$name" = "default" ]; then
            test_url="https://pypi.org"
        else
            test_url="$url"
        fi

        echo -n "  Testing PyPI ($name)... "
        if curl -s --connect-timeout 5 --max-time 10 -o /dev/null -w "%{http_code}" "$test_url" 2>/dev/null | grep -qE "^(200|301|302|403)"; then
            echo -e "${C_GREEN}OK${C_RESET}"
            if [ "$name" != "default" ]; then
                USE_MIRROR="$url"
                MIRROR_NAME="$name"
                info "Using mirror: ${MIRROR_NAME} (${USE_MIRROR})"
            else
                info "Using default PyPI"
            fi
            break
        else
            echo -e "${C_YELLOW}unreachable${C_RESET}"
        fi
    done

    # Build pip install command
    PIP_INSTALL_CMD="$PIP install $PIP_INSTALL_OPTS"
    if [ -n "$USE_MIRROR" ]; then
        PIP_INSTALL_CMD="$PIP_INSTALL_CMD -i $USE_MIRROR --trusted-host $(echo $USE_MIRROR | awk -F/ '{print $3}')"
    fi

    # Upgrade pip itself
    echo -n "  Upgrading pip..."
    $PIP_INSTALL_CMD --upgrade pip -q 2>&1 | tail -1
    info "pip upgraded"

    # Install requirements
    echo "  Installing Python packages..."
    if $PIP_INSTALL_CMD -r "${INSTALL_DIR}/backend/requirements.txt" 2>&1 | tail -5; then
        info "Python packages installed"
    else
        error "Failed to install Python dependencies"
        warn "You can try manually with a different mirror:"
        warn "  cd ${INSTALL_DIR} && source venv/bin/activate"
        warn "  pip install -i https://pypi.tuna.tsinghua.edu.cn/simple/ -r backend/requirements.txt"
        die "Installation aborted at Step 6"
    fi

    # Verify critical packages
    for pkg in fastapi uvicorn sqlalchemy aiomysql; do
        "${INSTALL_DIR}/venv/bin/pip" show "$pkg" &>/dev/null || warn "Package '$pkg' not found — may cause issues"
    done
    info "Critical packages verified"

    # ── Step 7: Configuration ───────────────────────────────────────────
    step "Step 7/8  Creating configuration..."

    cat > "${INSTALL_DIR}/.env" <<EOF
# NMS Configuration (generated $(date '+%Y-%m-%d %H:%M:%S'))
DB_HOST=${DB_HOST}
DB_PORT=${DB_PORT}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=${DB_NAME}

HOST=0.0.0.0
PORT=${NMS_PORT}
DEBUG=false

SNMP_TIMEOUT=2
SNMP_RETRIES=1

METRICS_COLLECTION_INTERVAL=60
ICMP_CHECK_INTERVAL=30
ALERT_CHECK_INTERVAL=60

SCAN_CONCURRENCY=100
SCAN_PING_TIMEOUT=0.5

METRICS_RETENTION_DAYS=90
EOF
    chmod 640 "${INSTALL_DIR}/.env"
    check_step ".env created" test -f "${INSTALL_DIR}/.env"

    # Save version
    echo "$CURRENT_VERSION" > "$VERSION_FILE"

    # Save credentials
    cat > "${INSTALL_DIR}/.credentials" <<EOF
NMS Database Credentials
========================
Host:     ${DB_HOST}:${DB_PORT}
Database: ${DB_NAME}
User:     ${DB_USER}
Password: ${DB_PASSWORD}
EOF
    chmod 600 "${INSTALL_DIR}/.credentials"
    info "Credentials saved to ${INSTALL_DIR}/.credentials"

    # ── Step 8: Systemd service ─────────────────────────────────────────
    step "Step 8/8  Installing systemd service..."

    cat > /etc/systemd/system/nms.service <<EOF
[Unit]
Description=NMS - Network Management System
After=network.target ${MYSQL_SERVICE}.service
Wants=${MYSQL_SERVICE}.service

[Service]
Type=simple
User=${NMS_USER}
Group=${NMS_USER}
WorkingDirectory=${INSTALL_DIR}/backend
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=${INSTALL_DIR}/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port ${NMS_PORT} --workers 4 --log-level info
ExecReload=/bin/kill -HUP \$MAINPID
Restart=on-failure
RestartSec=5
KillMode=mixed
TimeoutStopSec=30

NoNewPrivileges=no
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=${INSTALL_DIR}

[Install]
WantedBy=multi-user.target
EOF

    # Fix permissions and update systemd service
    chown -R "${NMS_USER}:${NMS_USER}" "$INSTALL_DIR"
    chmod 750 "$INSTALL_DIR"
    # Regenerate systemd service file (updates NoNewPrivileges and other settings)
    if [ -f /etc/systemd/system/nms.service ]; then
        sed -i 's/NoNewPrivileges=yes/NoNewPrivileges=no/' /etc/systemd/system/nms.service
        systemctl daemon-reload
    fi

    # Allow nms user to run nmap without password (needed for ARP scanning)
    echo "${NMS_USER} ALL=(ALL) NOPASSWD: /usr/bin/nmap, /usr/bin/ping, /usr/bin/nbtscan, /usr/bin/nmblookup" > /etc/sudoers.d/nms-nmap
    chmod 440 /etc/sudoers.d/nms-nmap
    # Allow ICMP ping for python and system ping
    setcap cap_net_raw+ep "${INSTALL_DIR}/venv/bin/python3" 2>/dev/null || true
    setcap cap_net_raw+ep /usr/bin/ping 2>/dev/null || true

    systemctl daemon-reload
    systemctl enable nms
    check_step "Systemd service installed" test -f "/etc/systemd/system/nms.service"

    # ── Start & verify ──────────────────────────────────────────────────
    step "Starting NMS..."
    systemctl restart nms
    sleep 3

    if systemctl is-active --quiet nms; then
        info "NMS service started successfully!"
    else
        warn "Service may need a moment. Checking logs..."
        journalctl -u nms --no-pager -n 20
        sleep 2
        if systemctl is-active --quiet nms; then
            info "NMS is now running"
        else
            warn "NMS service failed to start. Check: journalctl -u nms -n 50"
        fi
    fi

    # ── Final health check ──────────────────────────────────────────────
    sleep 2
    if curl -s "http://localhost:${NMS_PORT}/api/health" | grep -q "ok"; then
        info "HTTP health check PASSED"
        # Seed predefined device models
        echo -n "  Seeding device models..."
        local seed_result=$(curl -s -X POST "http://localhost:${NMS_PORT}/api/device-models/seed" -H 'Content-Type: application/json' -d '{}')
        if echo "$seed_result" | grep -q "seeded"; then
            info "Device models seeded ($seed_result)"
        else
            warn "Device model seeding may have failed"
        fi
    else
        warn "HTTP health check not responding yet — may take a few more seconds"
    fi

    # ── FINISH ──────────────────────────────────────────────────────────
    echo ""
    echo -e "${C_GREEN}${C_BOLD}╔══════════════════════════════════════════════════════╗${C_RESET}"
    echo -e "${C_GREEN}${C_BOLD}║     ✓  NMS Installation Complete!                    ║${C_RESET}"
    echo -e "${C_GREEN}${C_BOLD}╚══════════════════════════════════════════════════════╝${C_RESET}"
    echo ""
    echo -e "  Web Interface:  ${C_BOLD}http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost'):${NMS_PORT}${C_RESET}"
    echo -e "  API Docs:       ${C_BOLD}http://localhost:${NMS_PORT}/docs${C_RESET}"
    echo -e "  Health Check:   ${C_BOLD}http://localhost:${NMS_PORT}/api/health${C_RESET}"
    echo ""
    echo -e "  Database:       ${C_BOLD}${DB_HOST}:${DB_PORT}/${DB_NAME}${C_RESET}"
    echo -e "  DB User:        ${C_BOLD}${DB_USER}${C_RESET}"
    echo -e "  DB Password:    ${C_BOLD}${DB_PASSWORD}${C_RESET}"
    echo -e "  Saved to:       ${C_BOLD}${INSTALL_DIR}/.credentials${C_RESET}"
    echo ""
    echo -e "  ${C_BOLD}Manage service:${C_RESET}"
    echo "    sudo systemctl start nms"
    echo "    sudo systemctl stop nms"
    echo "    sudo systemctl restart nms"
    echo "    sudo systemctl status nms"
    echo "    sudo journalctl -u nms -f"
    echo ""
}

# ═════════════════════════════════════════════════════════════════════════════
# UNINSTALL
# ═════════════════════════════════════════════════════════════════════════════

do_uninstall() {
    banner
    check_root

    if [ ! -f "${INSTALL_DIR}/.env" ] && [ ! -f "/etc/systemd/system/nms.service" ]; then
        warn "NMS does not appear to be installed."
        read -rp "  Continue anyway? [y/N]: " c
        if [ "$c" != "y" ] && [ "$c" != "Y" ]; then exit 0; fi
    fi

    # Load existing config if available
    if [ -f "${INSTALL_DIR}/.env" ]; then
        source "${INSTALL_DIR}/.env"
    fi

    echo ""
    echo -e "${C_RED}${C_BOLD}╔══════════════════════════════════════════════════════╗${C_RESET}"
    echo -e "${C_RED}${C_BOLD}║     UNINSTALL NMS                                    ║${C_RESET}"
    echo -e "${C_RED}${C_BOLD}╚══════════════════════════════════════════════════════╝${C_RESET}"
    echo ""
    echo "  Select components to remove:"
    echo ""

    # ── Options ─────────────────────────────────────────────────────────
    echo "  [1] NMS application      — ${INSTALL_DIR} (~100 MB)"
    echo "  [2] NMS systemd service  — /etc/systemd/system/nms.service"
    echo "  [3] System user          — ${NMS_USER}"
    echo "  [4] MySQL database+user  — DB:${DB_NAME}  User:${DB_USER}  (data will be lost!)"
    echo "  [5] MySQL server         — mysql-server / mariadb-server package"
    echo "  [6] Nginx                — nginx package + config"
    echo "  [7] Python venv + deps   — ${INSTALL_DIR}/venv"
    echo "  [8] ALL OF THE ABOVE"
    echo "  [0] Cancel"
    echo ""

    read -rp "  Enter numbers (comma-separated, e.g. 1,2,3 or 8): " CHOICES
    if [ "$CHOICES" = "0" ] || [ -z "$CHOICES" ]; then
        echo "Aborted."; exit 0
    fi

    # Parse choices
    DO_APP=false; DO_SERVICE=false; DO_USER=false
    DO_DB=false; DO_MYSQL=false; DO_NGINX=false; DO_VENV=false

    IFS=',' read -ra PARTS <<< "$CHOICES"
    for c in "${PARTS[@]}"; do
        c=$(echo "$c" | tr -d ' ')
        case "$c" in
            8) DO_APP=true; DO_SERVICE=true; DO_USER=true
               DO_DB=true; DO_MYSQL=true; DO_NGINX=true; DO_VENV=true ;;
            1) DO_APP=true ;;
            2) DO_SERVICE=true ;;
            3) DO_USER=true ;;
            4) DO_DB=true ;;
            5) DO_MYSQL=true ;;
            6) DO_NGINX=true ;;
            7) DO_VENV=true ;;
        esac
    done

    echo ""
    echo -e "${C_RED}${C_BOLD}  About to remove:${C_RESET}"
    $DO_APP     && echo "    - NMS application files"
    $DO_SERVICE && echo "    - NMS systemd service"
    $DO_USER    && echo "    - System user '${NMS_USER}'"
    $DO_DB      && echo -e "    ${C_RED}- MySQL database '${DB_NAME}' + user '${DB_USER}'${C_RESET}"
    $DO_MYSQL   && echo -e "    ${C_RED}- MySQL/MariaDB server package${C_RESET}"
    $DO_NGINX   && echo "    - Nginx package + config"
    $DO_VENV    && echo "    - Python virtual environment"
    echo ""

    read -rp "  Type 'DELETE' to confirm: " CONFIRM
    if [ "$CONFIRM" != "DELETE" ]; then
        echo "Aborted."; exit 0
    fi

    echo ""

    # ── Execute ─────────────────────────────────────────────────────────

    # 1. Stop service (always needed if removing app)
    if $DO_APP || $DO_SERVICE; then
        step "Stopping NMS service..."
        systemctl stop nms 2>/dev/null && info "Service stopped" || warn "Not running"
        systemctl disable nms 2>/dev/null && info "Service disabled" || true
    fi

    # 2. Remove systemd service file
    if $DO_SERVICE; then
        rm -f /etc/systemd/system/nms.service && info "Service file removed"
        systemctl daemon-reload
    fi

    # 3. Remove application files
    if $DO_APP; then
        step "Removing application files..."
        if [ -d "$INSTALL_DIR" ]; then
            rm -rf "$INSTALL_DIR" && info "${INSTALL_DIR} removed" || warn "Failed"
        else
            info "${INSTALL_DIR} not found"
        fi
    fi

    # 4. Remove system user
    if $DO_USER; then
        step "Removing system user..."
        if id -u "$NMS_USER" &>/dev/null 2>&1; then
            userdel -r "$NMS_USER" 2>/dev/null && info "User '${NMS_USER}' removed" || warn "Failed"
        else
            info "User '${NMS_USER}' does not exist"
        fi
    fi

    # 5. Remove MySQL database + user
    if $DO_DB; then
        step "Removing MySQL database and user..."
        detect_mysql_auth
        if [ -n "$MYSQL_ADMIN_CMD" ]; then
            mysql_exec "DROP DATABASE IF EXISTS ${DB_NAME};" 2>/dev/null && info "Database '${DB_NAME}' dropped" || warn "Failed"
            for host in "localhost" "127.0.0.1" "%"; do
                mysql_exec "DROP USER IF EXISTS '${DB_USER}'@'${host}';" 2>/dev/null
            done
            info "User '${DB_USER}' removed"
        else
            warn "Cannot connect to MySQL to remove database. Skip."
        fi
    fi

    # 6. Remove MySQL server package
    if $DO_MYSQL; then
        step "Removing MySQL/MariaDB server..."
        if dpkg -l | grep -qE "mysql-server|mariadb-server"; then
            apt-get remove -y mysql-server mysql-client mariadb-server mariadb-client 2>&1 | tail -2
            info "MySQL/MariaDB packages removed"
        else
            info "MySQL/MariaDB package not found"
        fi
    fi

    # 7. Remove Nginx
    if $DO_NGINX; then
        step "Removing Nginx..."
        systemctl stop nginx 2>/dev/null || true
        if dpkg -l | grep -q "nginx"; then
            apt-get remove -y nginx nginx-common 2>&1 | tail -2
            info "Nginx removed"
        else
            info "Nginx not installed"
        fi
        rm -f /etc/nginx/sites-available/nms.conf /etc/nginx/sites-enabled/nms.conf
    fi

    # 8. Remove venv (if not already removed with app)
    if $DO_VENV && ! $DO_APP; then
        rm -rf "${INSTALL_DIR}/venv" && info "venv removed" || true
    fi

    echo ""
    echo -e "${C_GREEN}${C_BOLD}╔══════════════════════════════════════════════════════╗${C_RESET}"
    echo -e "${C_GREEN}${C_BOLD}║     ✓  Selected components uninstalled               ║${C_RESET}"
    echo -e "${C_GREEN}${C_BOLD}╚══════════════════════════════════════════════════════╝${C_RESET}"
    echo ""
}

# ═════════════════════════════════════════════════════════════════════════════
# UPGRADE
# ═════════════════════════════════════════════════════════════════════════════

# ═════════════════════════════════════════════════════════════════════════════
# SMART DEPLOY — checksum-based incremental sync
# ═════════════════════════════════════════════════════════════════════════════

do_deploy() {
    banner
    check_root

    echo ""
    echo -e "${C_CYAN}${C_BOLD}NMS Smart Deploy${C_RESET}"
    echo ""

    # Check if installed
    if [ ! -f "${INSTALL_DIR}/.env" ]; then
        die "NMS is not installed at ${INSTALL_DIR}. Run install first."
    fi

    SRC="${PROJECT_DIR}"
    DST="${INSTALL_DIR}"

    # ── Step -1: Regenerate VERSION from git (if source is a git repo) ────
    # Version is git-driven (tag/commits). Regenerate the manifest BEFORE
    # integrity check so VERSION matches the current working tree.
    if [ -d "${SRC}/.git" ] && command -v git &>/dev/null && command -v python3 &>/dev/null; then
        step "Regenerating VERSION from git..."
        ( cd "${SRC}" && python3 native/gen_version.py ) || warn "VERSION regeneration failed; using existing VERSION."
    fi

    # ── Step 0: Verify source integrity via VERSION manifest ─────────────
    step "Verifying source files against VERSION manifest..."
    local SRC_VER_FILE="${SRC}/VERSION"
    if [ ! -f "$SRC_VER_FILE" ]; then
        die "VERSION file not found in source. Run: python3 native/gen_version.py"
    fi

    local MANIFEST_ERRORS=0
    # Strip Windows CRLF from VERSION file
    local TMP_VERSION=$(mktemp)
    tr -d '\r' < "$SRC_VER_FILE" > "$TMP_VERSION"
    while IFS= read -r line; do
        # Parse "MD5  path" lines
        if [[ "$line" =~ ^[0-9a-f]{32}\ \  ]]; then
            local expected_md5="${line:0:32}"
            local file_path="${line:34}"
            local full_path="${SRC}/${file_path}"
            if [ -f "$full_path" ]; then
                local actual_md5=$(md5sum "$full_path" 2>/dev/null | awk '{print $1}')
                if [ "$actual_md5" != "$expected_md5" ]; then
                    echo -e "  ${C_RED}✗${C_RESET} $file_path — MD5 MISMATCH (expected: ${expected_md5:0:8}..., got: ${actual_md5:0:8}...)"
                    ((MANIFEST_ERRORS++))
                fi
            else
                echo -e "  ${C_YELLOW}?${C_RESET} $file_path — file not in source (may be OK)"
            fi
        fi
    done < "$TMP_VERSION"
    rm -f "$TMP_VERSION"

    if [ $MANIFEST_ERRORS -gt 0 ]; then
        echo ""
        die "${MANIFEST_ERRORS} file(s) have incorrect content. Re-upload files to server and try again."
    fi
    info "All source files verified against VERSION manifest."

    # ── Step 1: Scan source for changes ────────────────────────────────
    step "Scanning for changes (${SRC} → ${DST})..."

    CHANGED_FILES=()
    NEW_FILES=()
    DELETED_FILES=()
    REQS_CHANGED=false
    BACKEND_CHANGED=false
    FRONTEND_CHANGED=false

    # Compare backend files
    if [ -d "${SRC}/backend" ]; then
        while IFS= read -r -d '' src_file; do
            rel="${src_file#${SRC}/}"
            dst_file="${DST}/${rel}"

            if [ ! -f "$dst_file" ]; then
                NEW_FILES+=("$rel")
                BACKEND_CHANGED=true
                [[ "$rel" == *"requirements.txt" ]] && REQS_CHANGED=true
            elif ! cmp -s "$src_file" "$dst_file" 2>/dev/null; then
                CHANGED_FILES+=("$rel")
                BACKEND_CHANGED=true
                [[ "$rel" == *"requirements.txt" ]] && REQS_CHANGED=true
            fi
        done < <(find "${SRC}/backend" -type f -print0)
    fi

    # Compare frontend files
    if [ -d "${SRC}/frontend" ]; then
        while IFS= read -r -d '' src_file; do
            rel="${src_file#${SRC}/}"
            dst_file="${DST}/${rel}"

            if [ ! -f "$dst_file" ]; then
                NEW_FILES+=("$rel")
                FRONTEND_CHANGED=true
            elif ! cmp -s "$src_file" "$dst_file" 2>/dev/null; then
                CHANGED_FILES+=("$rel")
                FRONTEND_CHANGED=true
            fi
        done < <(find "${SRC}/frontend" -type f -print0)
    fi

    # Check for deleted files (in dst but not in src)
    for area in "backend" "frontend"; do
        if [ -d "${DST}/${area}" ] && [ -d "${SRC}/${area}" ]; then
            while IFS= read -r -d '' dst_file; do
                rel="${dst_file#${DST}/}"
                src_file="${SRC}/${rel}"
                if [ ! -f "$src_file" ]; then
                    DELETED_FILES+=("$rel")
                fi
            done < <(find "${DST}/${area}" -type f -not -name ".env" -not -name ".credentials" -not -name ".version" -print0)
        fi
    done

    # ── Show summary ───────────────────────────────────────────────────
    local total_changes=$((${#CHANGED_FILES[@]} + ${#NEW_FILES[@]} + ${#DELETED_FILES[@]}))

    # ── Auto DB migration: add missing columns/tables ───────────────────
    if [ -f "${INSTALL_DIR}/.env" ]; then
        source "${INSTALL_DIR}/.env"
        local MYSQL_CMD="mysql -u${DB_USER} -p${DB_PASSWORD} -h${DB_HOST} ${DB_NAME} -e"
        $MYSQL_CMD "CREATE TABLE IF NOT EXISTS parsed_oids (id VARCHAR(32) PRIMARY KEY, oid VARCHAR(255) NOT NULL UNIQUE, name VARCHAR(255) NOT NULL, description_zh VARCHAR(500), description_en VARCHAR(500), mib_source VARCHAR(100), created_at DATETIME DEFAULT CURRENT_TIMESTAMP);" 2>/dev/null || true
        $MYSQL_CMD "CREATE TABLE IF NOT EXISTS mib_files (id VARCHAR(32) PRIMARY KEY, filename VARCHAR(255) NOT NULL, file_type VARCHAR(20) NOT NULL, content TEXT, oid_count INT DEFAULT 0, mib_count INT DEFAULT 0, parsed_oids JSON, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);" 2>/dev/null || true
        $MYSQL_CMD "CREATE TABLE IF NOT EXISTS ai_settings (id VARCHAR(32) PRIMARY KEY, provider VARCHAR(50) DEFAULT 'openai', api_key VARCHAR(500) NOT NULL, api_base VARCHAR(500) DEFAULT 'https://api.openai.com/v1', model_name VARCHAR(100) DEFAULT 'gpt-4o-mini', enabled BOOLEAN DEFAULT TRUE, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP);" 2>/dev/null || true
        $MYSQL_CMD "ALTER TABLE template_items ADD COLUMN display_type VARCHAR(20) DEFAULT 'chart';" 2>/dev/null || true
        $MYSQL_CMD "ALTER TABLE template_items ADD COLUMN unit VARCHAR(50);" 2>/dev/null || true
        $MYSQL_CMD "ALTER TABLE monitoring_templates ADD COLUMN mib_file_ids JSON;" 2>/dev/null || true
        $MYSQL_CMD "ALTER TABLE monitoring_templates ADD COLUMN source VARCHAR(50) DEFAULT 'manual';" 2>/dev/null || true
        $MYSQL_CMD "ALTER TABLE ai_settings ADD COLUMN request_timeout INT DEFAULT 120;" 2>/dev/null || true
        $MYSQL_CMD "ALTER TABLE ai_settings ADD COLUMN group_timeout INT DEFAULT 180;" 2>/dev/null || true
    $MYSQL_CMD "CREATE TABLE IF NOT EXISTS oid_test_results (id VARCHAR(32) PRIMARY KEY, oid VARCHAR(500) NOT NULL, name VARCHAR(255), result_value TEXT, test_ip VARCHAR(50), tested_at DATETIME DEFAULT CURRENT_TIMESTAMP, INDEX idx_oid (oid));" 2>/dev/null || true
    fi

    # Ensure required tools are installed
    for tool in nmap nbtscan nmblookup; do
        if ! command -v $tool &>/dev/null; then
            case $tool in
                nmap) apt-get install -y -qq nmap 2>/dev/null && info "nmap installed" ;;
                nbtscan) apt-get install -y -qq nbtscan 2>/dev/null && info "nbtscan installed" ;;
                nmblookup) apt-get install -y -qq samba-common-bin 2>/dev/null && info "samba-common-bin installed" ;;
            esac
        fi
    done
    if [ ! -f /etc/sudoers.d/nms-nmap ]; then
        echo "${NMS_USER} ALL=(ALL) NOPASSWD: /usr/bin/nmap, /usr/bin/ping, /usr/bin/nbtscan, /usr/bin/nmblookup" > /etc/sudoers.d/nms-nmap
        chmod 440 /etc/sudoers.d/nms-nmap
        info "nmap sudoers added for ${NMS_USER}"
    else
        # Update existing sudoers to include ping
        grep -q "/usr/bin/ping" /etc/sudoers.d/nms-nmap || \
            sed -i 's|/usr/bin/nmap|/usr/bin/nmap, /usr/bin/ping|' /etc/sudoers.d/nms-nmap
    fi
    # Allow ICMP for both python and system ping
    setcap cap_net_raw+ep "${DST}/venv/bin/python3" 2>/dev/null || true
    setcap cap_net_raw+ep /usr/bin/ping 2>/dev/null || true

    # Sync version file (git-driven; regenerated in Step -1 above)
    if [ -f "${SRC}/VERSION" ]; then
        local src_ver=$(head -1 "${SRC}/VERSION" | tr -d '\r')
        cp "${SRC}/VERSION" "${DST}/VERSION"
        chown "${NMS_USER}:${NMS_USER}" "${DST}/VERSION" 2>/dev/null || true
        info "Version: ${src_ver}"
    fi

    if [ $total_changes -eq 0 ]; then
        info "No changes detected. Everything is up to date."
        local v=$(cat "${DST}/VERSION" 2>/dev/null || echo "unknown")
        echo -e "  ${C_GREEN}Version: ${v} ✓${C_RESET}"
        return 0
    fi

    echo ""
    echo -e "  ${C_BOLD}Changes detected:${C_RESET}"
    echo -e "  ${C_YELLOW}$((${#CHANGED_FILES[@]} + ${#NEW_FILES[@]}))${C_RESET} files to update, ${C_RED}${#DELETED_FILES[@]}${C_RESET} to remove"
    echo ""

    # Show changed files (max 20)
    local shown=0
    for f in "${CHANGED_FILES[@]}" "${NEW_FILES[@]}"; do
        if [ $shown -lt 20 ]; then
            echo -e "    ${C_YELLOW}M${C_RESET} $f"
            ((shown++))
        fi
    done
    if [ $shown -lt $((${#CHANGED_FILES[@]} + ${#NEW_FILES[@]})) ]; then
        echo "    ... and $((${#CHANGED_FILES[@]} + ${#NEW_FILES[@]} - shown)) more"
    fi
    for f in "${DELETED_FILES[@]}"; do
        if [ $shown -lt 20 ]; then
            echo -e "    ${C_RED}D${C_RESET} $f"
            ((shown++))
        fi
    done
    echo ""

    # Show what will happen
    if $BACKEND_CHANGED; then
        echo -e "  ${C_YELLOW}⟳  Backend changed — will restart NMS service${C_RESET}"
    fi
    if $FRONTEND_CHANGED && ! $BACKEND_CHANGED; then
        echo -e "  ${C_GREEN}→  Frontend only — no restart needed (just refresh browser)${C_RESET}"
    fi
    if $REQS_CHANGED; then
        echo -e "  ${C_YELLOW}⟳  requirements.txt changed — will update Python packages${C_RESET}"
    fi

    echo ""
    read -rp "  Apply these changes? [Y/n]: " CONFIRM
    if [ "$CONFIRM" = "n" ] || [ "$CONFIRM" = "N" ]; then
        echo "Aborted."
        return 0
    fi

    # ── Step 2: Apply changes ──────────────────────────────────────────
    echo ""

    # Stop service only if backend changed
    if $BACKEND_CHANGED; then
        step "Stopping NMS service..."
        systemctl stop nms 2>/dev/null && info "Service stopped" || true
    fi

    # Sync changed + new files with MD5 verification
    local md5_ok=0 md5_fail=0
    for f in "${CHANGED_FILES[@]}" "${NEW_FILES[@]}"; do
        src_file="${SRC}/${f}"
        dst_file="${DST}/${f}"
        mkdir -p "$(dirname "$dst_file")"
        local src_md5=$(md5sum "$src_file" 2>/dev/null | awk '{print $1}')
        cp "$src_file" "$dst_file" 2>/dev/null || warn "Failed to copy: $f"
        local dst_md5=$(md5sum "$dst_file" 2>/dev/null | awk '{print $1}')
        if [ "$src_md5" = "$dst_md5" ]; then
            ((md5_ok++))
        else
            ((md5_fail++))
            echo -e "  ${C_RED}MD5 mismatch: $f${C_RESET}"
            echo "    src: $src_md5"
            echo "    dst: $dst_md5"
        fi
    done

    # Remove deleted files
    for f in "${DELETED_FILES[@]}"; do
        rm -f "${DST}/${f}" 2>/dev/null
    done

    info "${md5_ok} files OK, ${md5_fail} MD5 mismatches"

    # Strip CR characters (Windows line endings) from all text files
    _strip_cr "$DST"

    # Update requirements if changed
    if $REQS_CHANGED; then
        step "Updating Python packages..."
        PIP="${INSTALL_DIR}/venv/bin/pip"
        PIP_OPTS="--default-timeout=120"
        MIRROR=""

        for entry in "default|https://pypi.org/simple/" "tsinghua|https://pypi.tuna.tsinghua.edu.cn/simple/" \
                     "aliyun|https://mirrors.aliyun.com/pypi/simple/"; do
            name="${entry%%|*}"; url="${entry##*|}"
            if curl -s --connect-timeout 5 --max-time 10 -o /dev/null "${url}" 2>/dev/null; then
                [ "$name" != "default" ] && MIRROR="$url"
                break
            fi
        done

        PIP_CMD="$PIP install $PIP_OPTS"
        [ -n "$MIRROR" ] && PIP_CMD="$PIP_CMD -i $MIRROR --trusted-host $(echo $MIRROR | awk -F/ '{print $3}')"

        $PIP_CMD -r "${INSTALL_DIR}/backend/requirements.txt" 2>&1 | tail -3
        check_step "Dependencies updated" true
    fi

    # Ensure critical packages are installed (safety net)
    local PIP_SAFE="${INSTALL_DIR}/venv/bin/pip"
    for pkg in httpx; do
        if ! $PIP_SAFE show "$pkg" &>/dev/null; then
            warn "Package '$pkg' missing, installing..."
            $PIP_SAFE install "$pkg" 2>&1 | tail -1
        fi
    done

    # Fix permissions
    chown -R "${NMS_USER}:${NMS_USER}" "$INSTALL_DIR" 2>/dev/null || true

    # Restart only if backend changed
    if $BACKEND_CHANGED; then
        step "Restarting NMS..."
        systemctl restart nms
        sleep 3

        if systemctl is-active --quiet nms; then
            info "NMS restarted successfully"
        else
            warn "NMS might have issues. Check logs:"
            journalctl -u nms --no-pager -n 20
        fi

        if curl -s "http://localhost:${NMS_PORT}/api/health" | grep -q "ok"; then
            info "Health check PASSED"
        fi
    else
        info "No restart needed (frontend only)"
    fi

    echo ""
    echo -e "${C_GREEN}${C_BOLD}╔══════════════════════════════════════════════════════╗${C_RESET}"
    echo -e "${C_GREEN}${C_BOLD}║     ✓  Deploy complete                               ║${C_RESET}"
    echo -e "${C_GREEN}${C_BOLD}╚══════════════════════════════════════════════════════╝${C_RESET}"

    if ! $BACKEND_CHANGED && $FRONTEND_CHANGED; then
        echo -e "  ${C_YELLOW}Tip: Hard-refresh browser (Ctrl+Shift+R) to see frontend changes.${C_RESET}"
    fi
    echo ""

    # Auto-verify after deploy
    do_verify

    # Version check
    local src_ver=$(head -1 "${SRC}/VERSION" 2>/dev/null | tr -d '\r' || echo "unknown")
    local dst_ver=$(head -1 "${DST}/VERSION" 2>/dev/null | tr -d '\r' || echo "unknown")
    echo ""
    if [ "$src_ver" = "$dst_ver" ]; then
        echo -e "  ${C_GREEN}Version: ${src_ver} ✓${C_RESET}"
    else
        echo -e "  ${C_RED}Version mismatch! Source: ${src_ver}  Installed: ${dst_ver}${C_RESET}"
        echo -e "  ${C_RED}Files may not have deployed correctly. Re-run deploy or check manually.${C_RESET}"
    fi
}

# ── Alias: upgrade = deploy ────────────────────────────────────────────────
do_upgrade() {
    do_deploy
}

# ═════════════════════════════════════════════════════════════════════════════
# INTERACTIVE MENU
# ═════════════════════════════════════════════════════════════════════════════

# ── Strip CR (Windows line endings) from text files ───────────────────────
_strip_cr() {
    local target="${1:-$INSTALL_DIR}"
    [ -d "$target" ] || return 0
    # Strip CR from all .sh .py .js .css .html .txt .json .yaml .md files
    find "$target" -type f \( \
        -name "*.sh" -o -name "*.py" -o -name "*.js" -o -name "*.css" \
        -o -name "*.html" -o -name "*.txt" -o -name "*.json" -o -name "*.yaml" \
        -o -name "*.yml" -o -name "*.md" -o -name ".env" -o -name "*.example" \
        -o -name "*.cfg" -o -name "*.conf" \
    \) -exec sed -i 's/\r$//' {} \; 2>/dev/null || true
}

# ═════════════════════════════════════════════════════════════════════════════
# VERIFY — check deployment integrity
# ═════════════════════════════════════════════════════════════════════════════

do_verify() {
    echo ""
    echo -e "${C_BOLD}── Verifying deployment...${C_RESET}"
    echo ""

    local SRC="${PROJECT_DIR}"
    local DST="${INSTALL_DIR}"
    local ERRORS=0
    local OK=0

    # Key files that MUST be deployed
    local KEY_FILES=(
        "VERSION"
        "frontend/index.html"
        "frontend/js/app.js"
        "frontend/js/api.js"
        "frontend/js/i18n.js"
        "frontend/js/pages/devices.js"
        "frontend/js/pages/discovery.js"
        "frontend/js/pages/topology.js"
        "frontend/js/pages/add-device.js"
        "frontend/js/pages/device-models.js"
        "frontend/js/pages/device-types.js"
        "frontend/js/utils/format.js"
        "frontend/css/main.css"
        "frontend/css/topology.css"
        "backend/app/main.py"
        "backend/app/routers/devices.py"
        "backend/app/routers/discovery.py"
    )

    for f in "${KEY_FILES[@]}"; do
        local src_file="${SRC}/${f}"
        local dst_file="${DST}/${f}"

        if [ ! -f "$src_file" ]; then
            echo -e "  ${C_RED}✗${C_RESET} $f — missing in source (${SRC})"
            ((ERRORS++))
            continue
        fi

        if [ ! -f "$dst_file" ]; then
            echo -e "  ${C_RED}✗${C_RESET} $f — NOT DEPLOYED to ${DST}"
            ((ERRORS++))
            continue
        fi

        if ! cmp -s "$src_file" "$dst_file" 2>/dev/null; then
            local src_size=$(stat -c%s "$src_file" 2>/dev/null || echo 0)
            local dst_size=$(stat -c%s "$dst_file" 2>/dev/null || echo 0)
            echo -e "  ${C_YELLOW}⟳${C_RESET} $f — OUTDATED (src:${src_size}B dst:${dst_size}B)"
            ((ERRORS++))
        else
            echo -e "  ${C_GREEN}✓${C_RESET} $f"
            ((OK++))
        fi
    done

    echo ""
    echo -e "  ${C_GREEN}OK: ${OK}${C_RESET}  ${C_YELLOW}Outdated: ${ERRORS}${C_RESET}"

    if [ $ERRORS -gt 0 ]; then
        echo ""
        echo -e "  ${C_YELLOW}Run 'sudo bash native/nms.sh deploy' to sync outdated files.${C_RESET}"
    fi
    echo ""
}

# ═════════════════════════════════════════════════════════════════════════════
# SET-SERVER — configure TFTP update server address
# ═════════════════════════════════════════════════════════════════════════════

do_set_server() {
    banner
    local cfg="${INSTALL_DIR}/.update_server"
    local current=""
    if [ -f "$cfg" ]; then current=$(cat "$cfg"); fi

    echo ""
    echo -e "TFTP update server: ${C_BOLD}${current:-not set}${C_RESET}"
    echo ""
    echo "Enter the TFTP server IP or hostname where NMS files are served."
    echo "The server should serve files from the NMS project root directory."
    echo "Example: 10.0.0.1"
    echo ""
    read -rp "Server [${current}]: " NEW_SERVER
    if [ -n "$NEW_SERVER" ]; then
        echo "$NEW_SERVER" > "$cfg"
        info "Update server set to: ${NEW_SERVER}"
    else
        info "Unchanged."
    fi
    if ! command -v curl &>/dev/null; then
        apt-get install -y -qq curl 2>/dev/null && info "curl installed"
    fi
}

# ═════════════════════════════════════════════════════════════════════════════
# UPDATE — download new version from TFTP, verify with VERSION MD5, deploy
# ═════════════════════════════════════════════════════════════════════════════

# ── Auto DB migration helper (called at start of every update) ──────────
_auto_migrate_db() {
    if [ ! -f "${INSTALL_DIR}/.env" ]; then return 0; fi
    source "${INSTALL_DIR}/.env"
    local M="mysql -u${DB_USER} -p${DB_PASSWORD} -h${DB_HOST} ${DB_NAME} -e"
    # Create missing tables
    $M "CREATE TABLE IF NOT EXISTS parsed_oids (id VARCHAR(32) PRIMARY KEY, oid VARCHAR(255) NOT NULL UNIQUE, name VARCHAR(255) NOT NULL, description_zh VARCHAR(500), description_en VARCHAR(500), mib_source VARCHAR(100), created_at DATETIME DEFAULT CURRENT_TIMESTAMP);" 2>/dev/null || true
    $M "CREATE TABLE IF NOT EXISTS mib_files (id VARCHAR(32) PRIMARY KEY, filename VARCHAR(255) NOT NULL, file_type VARCHAR(20) NOT NULL, content TEXT, oid_count INT DEFAULT 0, mib_count INT DEFAULT 0, parsed_oids JSON, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);" 2>/dev/null || true
    $M "CREATE TABLE IF NOT EXISTS ai_settings (id VARCHAR(32) PRIMARY KEY, provider VARCHAR(50) DEFAULT 'openai', api_key VARCHAR(500) NOT NULL, api_base VARCHAR(500) DEFAULT 'https://api.openai.com/v1', model_name VARCHAR(100) DEFAULT 'gpt-4o-mini', enabled BOOLEAN DEFAULT TRUE, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP);" 2>/dev/null || true
    # Add missing columns (template_items)
    $M "ALTER TABLE template_items ADD COLUMN display_type VARCHAR(20) DEFAULT 'chart';" 2>/dev/null || true
    $M "ALTER TABLE template_items ADD COLUMN unit VARCHAR(50);" 2>/dev/null || true
    $M "ALTER TABLE template_items ADD COLUMN metric_type VARCHAR(50) DEFAULT 'custom';" 2>/dev/null || true
    $M "ALTER TABLE template_items ADD COLUMN protocol VARCHAR(20) DEFAULT 'snmp';" 2>/dev/null || true
    $M "ALTER TABLE template_items ADD COLUMN data_type VARCHAR(20) DEFAULT 'gauge';" 2>/dev/null || true
    # Add missing columns (monitoring_templates)
    $M "ALTER TABLE monitoring_templates ADD COLUMN mib_file_ids JSON;" 2>/dev/null || true
    $M "ALTER TABLE monitoring_templates ADD COLUMN source VARCHAR(50) DEFAULT 'manual';" 2>/dev/null || true
    $M "ALTER TABLE ai_settings ADD COLUMN request_timeout INT DEFAULT 120;" 2>/dev/null || true
    $M "ALTER TABLE ai_settings ADD COLUMN group_timeout INT DEFAULT 180;" 2>/dev/null || true
    $M "CREATE TABLE IF NOT EXISTS oid_test_results (id VARCHAR(32) PRIMARY KEY, oid VARCHAR(500) NOT NULL, name VARCHAR(255), result_value TEXT, test_ip VARCHAR(50), tested_at DATETIME DEFAULT CURRENT_TIMESTAMP, INDEX idx_oid (oid));" 2>/dev/null || true
    $M "ALTER TABLE devices ADD COLUMN snmp_template_id VARCHAR(32);" 2>/dev/null || true
    $M "ALTER TABLE devices ADD COLUMN mib_file_id VARCHAR(32);" 2>/dev/null || true
    $M "ALTER TABLE devices ADD COLUMN cisco_list_id VARCHAR(32);" 2>/dev/null || true
    $M "ALTER TABLE devices ADD COLUMN zabbix_template_id VARCHAR(32);" 2>/dev/null || true
    $M "ALTER TABLE device_models ADD COLUMN template_type VARCHAR(20);" 2>/dev/null || true
    $M "ALTER TABLE device_models ADD COLUMN template_ref_id VARCHAR(32);" 2>/dev/null || true
    info "DB migration check complete"
}

# ── Install/update Python dependencies ───────────────────────────────────
_install_deps() {
    local req="${INSTALL_DIR}/backend/requirements.txt"
    local venv_pip="${INSTALL_DIR}/venv/bin/pip"
    [ -f "$req" ] || return 0
    [ -x "$venv_pip" ] || return 0

    # Check if any required packages are missing (quick check)
    local missing=false
    for pkg in httpx pyyaml fastapi uvicorn sqlalchemy aiomysql loguru; do
        if ! $venv_pip show "$pkg" &>/dev/null; then
            missing=true
            break
        fi
    done

    if $missing; then
        echo ""
        info "Installing missing Python dependencies..."
        $venv_pip install --default-timeout=120 -r "$req" 2>&1 | tail -5
        info "Dependencies installed"
    fi
}

# ── Sync PROJECT_DIR → INSTALL_DIR (file-level copy) ──────────────────
_sync_to_install() {
    local bac="${1:-false}"
    local synced=0

    step "Syncing ${PROJECT_DIR} → ${INSTALL_DIR} ..."

    # Sync each area
    for area in "backend" "frontend" "native"; do
        if [ -d "${PROJECT_DIR}/${area}" ]; then
            mkdir -p "${INSTALL_DIR}/${area}"
            # Use rsync if available, otherwise cp
            if command -v rsync &>/dev/null; then
                rsync -a --delete "${PROJECT_DIR}/${area}/" "${INSTALL_DIR}/${area}/" 2>/dev/null && ((synced++)) || true
            else
                cp -r "${PROJECT_DIR}/${area}/"* "${INSTALL_DIR}/${area}/" 2>/dev/null && ((synced++)) || true
            fi
        fi
    done

    # Copy VERSION to install dir
    cp "${PROJECT_DIR}/VERSION" "${INSTALL_DIR}/VERSION" 2>/dev/null || true
    chown -R "${NMS_USER}:${NMS_USER}" "$INSTALL_DIR" 2>/dev/null || true

    info "Synced ${synced} areas to ${INSTALL_DIR}"

    # Strip CR line endings from all synced text files
    _strip_cr "$INSTALL_DIR"

    # Install/update Python dependencies (safety net)
    _install_deps

    # Restart if backend changed
    if $bac; then
        step "Restarting NMS..."
        systemctl restart nms; sleep 2
        systemctl is-active --quiet nms && info "NMS running" || warn "Check logs: journalctl -u nms -n 20"
        curl -s "http://localhost:${NMS_PORT}/api/health" | grep -q "ok" && info "Health OK" || true
    elif [ $synced -gt 0 ]; then
        info "Frontend only — reload browser to see changes"
    fi
}

do_update() {
    banner
    check_root

    # ── Git-first: update from git when source is a git repository ──────
    if [ -d "${PROJECT_DIR}/.git" ] && command -v git &>/dev/null; then
        info "Source is a git repository — updating from git."
        if ( cd "${PROJECT_DIR}" && git pull --ff-only ); then
            info "git pull OK."
        else
            warn "git pull failed (no remote configured or local changes). Proceeding with local state."
        fi
        do_deploy
        return 0
    fi

    local cfg="${INSTALL_DIR}/.update_server"
    if [ ! -f "$cfg" ]; then
        die "Update server not configured. Run: sudo bash native/nms.sh set-server"
    fi
    local SERVER=$(cat "$cfg")

    echo ""
    echo -e "Update server: ${C_BOLD}${SERVER}${C_RESET}"
    echo ""

    local TMP=$(mktemp -d)
    local SRC_VER="${TMP}/VERSION"

    # ── Auto DB migration (ALWAYS run before version check) ─────────────
    _auto_migrate_db

    # ── Download VERSION from TFTP ──────────────────────────────────────
    step "Downloading VERSION from tftp://${SERVER}..."
    if curl -s --connect-timeout 5 -o "$SRC_VER" "tftp://${SERVER}/VERSION" 2>/dev/null; then
        local new_ver=$(head -1 "$SRC_VER" 2>/dev/null | tr -d '\r')
        local old_ver=$(head -1 "${INSTALL_DIR}/VERSION" 2>/dev/null | tr -d '\r' || echo "0.0.0")
        proj_ver=$(head -1 "${PROJECT_DIR}/VERSION" 2>/dev/null | tr -d '\r' || echo "N/A")
        installed_ver="$old_ver"
        info "TFTP: v${new_ver}  |  ~/NMS: v${proj_ver}  |  /opt/nms: v${old_ver}"
    else
        rm -rf "$TMP"
        die "Failed to download VERSION. Is TFTP server running at ${SERVER}?"
    fi

    # ── Download to PROJECT_DIR first (keep ~/NMS/ always in sync) ──────
    step "Downloading files to ${PROJECT_DIR} ..."
    local DL=0 ERR=0 SKIP=0 BAC=false

    while IFS= read -r line; do
        local cur=$(echo "$line" | awk '{print $1}')
        local fp=$(echo "$line" | awk '{print $2}')
        # VERSION format: "MD5  filepath" (2 columns)
        if [[ "$cur" =~ ^[0-9a-f]{32}$ ]] && [ -n "$fp" ] && [ "$fp" != "GENERATED" ]; then
            local dst="${PROJECT_DIR}/${fp}"
            local need_dl=false
            # Compare installed file's actual MD5 against expected — prev field is advisory only
            if [ -f "$dst" ]; then
                local dst_md5=$(md5sum "$dst" 2>/dev/null | awk '{print $1}')
                [ "$dst_md5" != "$cur" ] && need_dl=true
            else
                need_dl=true  # file missing
            fi
            if $need_dl; then
                mkdir -p "$(dirname "$dst")"
                echo -n "  ${fp} ... "
                if curl -s --connect-timeout 5 -o "$dst" "tftp://${SERVER}/${fp}" 2>/dev/null; then
                    local act=$(md5sum "$dst" 2>/dev/null | awk '{print $1}')
                    if [ "$act" = "$cur" ]; then
                        echo -e "${C_GREEN}OK${C_RESET}"; ((DL++))
                        [[ "$fp" == backend/* ]] && BAC=true
                    else
                        echo -e "${C_RED}MD5${C_RESET}"; ((ERR++))
                    fi
                else
                    echo -e "${C_YELLOW}FAIL${C_RESET}"; ((ERR++))
                fi
            else
                ((SKIP++))
            fi
        fi
    done < <(tr -d '\r' < "$SRC_VER")

    # ── Update VERSION ──────────────────────────────────────────────────
    cp "$SRC_VER" "${PROJECT_DIR}/VERSION"
    rm -rf "$TMP"

    # ── Check if INSTALL_DIR is behind (even if PROJECT_DIR is current) ──
    local installed_ver=$(head -1 "${INSTALL_DIR}/VERSION" 2>/dev/null | tr -d '\r' || echo "0.0.0")
    local need_install_sync=false
    if [ "$installed_ver" != "$new_ver" ]; then
        need_install_sync=true
    elif [ $DL -gt 0 ]; then
        need_install_sync=true
    fi

    if [ $DL -eq 0 ] && [ $ERR -eq 0 ] && ! $need_install_sync; then
        info "All 3 locations in sync: v${new_ver}"
        return 0
    fi

    if [ $DL -gt 0 ]; then
        info "TFTP → ~/NMS: Downloaded ${DL}, Skipped ${SKIP}, Errors ${ERR}"
        # NOTE: do NOT _strip_cr on PROJECT_DIR here —
        # it would corrupt the currently running nms.sh via sed -i
    fi
    if $need_install_sync; then
        info "~/NMS → /opt/nms: syncing (v${proj_ver} → v${installed_ver})"
    fi

    # ── Deploy from PROJECT_DIR to INSTALL_DIR ──────────────────────────
    _sync_to_install "$BAC"

    echo ""
    echo -e "${C_GREEN}${C_BOLD}╔══════════════════════════════════════════════════════╗${C_RESET}"
    if [ "$new_ver" != "$old_ver" ]; then
        echo -e "${C_GREEN}${C_BOLD}║     Updated v${old_ver} → v${new_ver}                          ║${C_RESET}"
    else
        echo -e "${C_GREEN}${C_BOLD}║     v${new_ver} — ${DL} files refreshed                      ║${C_RESET}"
    fi
    echo -e "${C_GREEN}${C_BOLD}╚══════════════════════════════════════════════════════╝${C_RESET}"
    echo ""
}

show_menu() {
    banner
    echo ""
    echo "  1) Install        — Fresh installation of NMS"
    echo "  2) Uninstall      — Remove components from system"
    echo "  3) Update         — Download & deploy from TFTP server"
    echo "  4) Set Server     — Configure TFTP update server address"
    echo "  5) Status         — Show current status"
    echo "  6) Verify         — Check deployment integrity"
    echo "  7) Exit"
    echo ""
    read -rp "  Select [1-7]: " CHOICE

    case "$CHOICE" in
        1) do_install ;;
        2) do_uninstall ;;
        3) do_update ;;
        4) do_set_server ;;
        5) do_status ;;
        6) do_verify ;;
        7) echo "Bye."; exit 0 ;;
        *) echo "Invalid choice."; show_menu ;;
    esac
}

# ═════════════════════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════════════════════

case "${1:-menu}" in
    install)   do_install ;;
    uninstall) do_uninstall ;;
    update|deploy|upgrade) do_update ;;
    set-server) do_set_server ;;
    status)    do_status ;;
    verify)    do_verify ;;
    menu|"")   show_menu ;;
    *)
        echo "Usage: sudo bash nms.sh [install|uninstall|update|set-server|status|verify]"
        echo "       sudo bash nms.sh          (interactive menu)"
        exit 1
        ;;
esac
