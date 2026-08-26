# NMS - Native Deployment Guide

This guide covers installing NMS directly on Linux or Windows without Docker.

## Table of Contents

- [Quick Install (Linux)](#quick-install-linux)
- [Quick Install (Windows)](#quick-install-windows)
- [Manual Installation (Linux)](#manual-installation-linux)
- [Manual Installation (Windows)](#manual-installation-windows)
- [Post-Installation](#post-installation)
- [Production Hardening](#production-hardening)
- [Upgrading](#upgrading)
- [Troubleshooting](#troubleshooting)

---

## Quick Install (Linux)

One-command management script (install / uninstall / upgrade / status all in one):

```bash
# Interactive menu — choose Install/Uninstall/Upgrade/Status
sudo bash native/nms.sh

# Or directly:
sudo bash native/nms.sh install      # Fresh install
sudo bash native/nms.sh uninstall    # Remove NMS
sudo bash native/nms.sh upgrade      # Update to latest version
sudo bash native/nms.sh status       # Show system status
```

The installer automatically:
1. Detects OS and installs system dependencies
2. Sets up MySQL 8.0 (auto-detects socket auth on Debian)
3. Creates database + user with secure auto-generated password
4. Deploys all application files to `/opt/nms`
5. Sets up Python virtual environment with all dependencies
6. Generates `.env` configuration
7. Creates and starts `systemd` service
8. Each step validated — stops immediately if something fails

---

## Quick Install (Windows)

Run PowerShell **as Administrator**:

```powershell
# Interactive menu
.\native\nms.ps1

# Or directly:
.\native\nms.ps1 install      # Fresh install
.\native\nms.ps1 uninstall    # Remove NMS
.\native\nms.ps1 upgrade      # Update to latest version
.\native\nms.ps1 status       # Show system status
```

The installer automatically handles NSSM service creation (or Scheduled Task fallback), MySQL setup, Python environment, and firewall rules. Each step validates before proceeding.

---

## Manual Installation (Linux)

### Prerequisites

- **OS**: Ubuntu 20.04+ / Debian 11+ / CentOS 8+ / RHEL 8+ / Fedora 36+
- **Python**: 3.9 or higher (3.11+ recommended)
- **MySQL**: 8.0 or higher
- **RAM**: 1 GB minimum, 2 GB recommended
- **Disk**: 5 GB minimum for application + metrics data

### Step 1: Install System Dependencies

**Ubuntu / Debian:**
```bash
sudo apt update
sudo apt install -y python3 python3-pip python3-venv python3-dev \
    gcc libffi-dev libssl-dev snmp-mibs-downloader mysql-server
```

**CentOS / RHEL / Fedora:**
```bash
sudo dnf install -y python3 python3-pip python3-devel \
    gcc libffi-devel openssl-devel net-snmp-utils mysql-server
sudo systemctl enable mysqld --now
```

### Step 2: Install and Configure MySQL

```bash
# Start MySQL
sudo systemctl enable mysql --now   # Debian/Ubuntu
sudo systemctl enable mysqld --now  # CentOS/RHEL

# Secure install
sudo mysql_secure_installation

# Create database and user
sudo mysql -u root -p <<EOF
CREATE DATABASE IF NOT EXISTS nms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'nms'@'localhost' IDENTIFIED BY 'your_secure_password';
CREATE USER IF NOT EXISTS 'nms'@'127.0.0.1' IDENTIFIED BY 'your_secure_password';
GRANT ALL PRIVILEGES ON nms.* TO 'nms'@'localhost';
GRANT ALL PRIVILEGES ON nms.* TO 'nms'@'127.0.0.1';
FLUSH PRIVILEGES;
EOF

# Verify connection
mysql -u nms -p -e "SELECT 1" nms
```

You can also use the provided SQL script with variable substitution:
```bash
sudo mysql -u root -p -e "
  SET @db_name='nms';
  SET @db_user='nms';
  SET @db_pass='your_secure_password';
  SOURCE native/init_db.sql;
"
```

### Step 3: Create System User

```bash
sudo useradd -r -m -d /opt/nms -s /usr/sbin/nologin nms
```

### Step 4: Deploy Application Files

```bash
# Copy application to install directory
sudo mkdir -p /opt/nms
sudo cp -r backend /opt/nms/
sudo cp -r frontend /opt/nms/
```

### Step 5: Set Up Python Virtual Environment

```bash
cd /opt/nms
sudo python3 -m venv venv
sudo ./venv/bin/pip install --upgrade pip
sudo ./venv/bin/pip install -r backend/requirements.txt
```

### Step 6: Create Configuration

```bash
sudo tee /opt/nms/.env > /dev/null <<EOF
DB_HOST=localhost
DB_PORT=3306
DB_USER=nms
DB_PASSWORD=your_secure_password
DB_NAME=nms

HOST=0.0.0.0
PORT=8000
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

sudo chmod 640 /opt/nms/.env
sudo chown -R nms:nms /opt/nms
```

### Step 7: Create Systemd Service

```bash
sudo cp native/nms.service /etc/systemd/system/nms.service
sudo systemctl daemon-reload
sudo systemctl enable nms
sudo systemctl start nms
```

### Step 8: Verify

```bash
# Check service status
sudo systemctl status nms

# Test HTTP endpoint
curl http://localhost:8000/api/health

# View logs
sudo journalctl -u nms -f
```

---

## Manual Installation (Windows)

### Prerequisites

- **Windows**: 10/11 or Server 2019/2022
- **Python**: 3.9 or higher (install from [python.org](https://www.python.org/downloads/))
  - **IMPORTANT**: Check "Add Python to PATH" during installation
- **MySQL**: 8.0 or higher (install from [MySQL Installer](https://dev.mysql.com/downloads/installer/))
- **Git**: Optional, for cloning (install from [git-scm.com](https://git-scm.com/))

### Step 1: Install Python

```powershell
# Verify Python installation
python --version
pip --version
```

### Step 2: Install and Configure MySQL

1. Download MySQL Installer from https://dev.mysql.com/downloads/installer/
2. Run the installer, choose "Server only" or "Developer Default"
3. During setup:
   - Set root password
   - Create `nms` user with password
   - Create `nms` database with charset `utf8mb4`

Or use MySQL Shell:
```sql
CREATE DATABASE IF NOT EXISTS nms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'nms'@'localhost' IDENTIFIED BY 'your_secure_password';
CREATE USER IF NOT EXISTS 'nms'@'127.0.0.1' IDENTIFIED BY 'your_secure_password';
GRANT ALL PRIVILEGES ON nms.* TO 'nms'@'localhost';
GRANT ALL PRIVILEGES ON nms.* TO 'nms'@'127.0.0.1';
FLUSH PRIVILEGES;
```

### Step 3: Deploy Application

```powershell
# Copy files to install directory
New-Item -ItemType Directory -Force -Path C:\NMS

# Copy backend and frontend
Copy-Item -Recurse backend C:\NMS\
Copy-Item -Recurse frontend C:\NMS\
```

### Step 4: Python Virtual Environment

```powershell
cd C:\NMS
python -m venv venv
.\venv\Scripts\pip install --upgrade pip
.\venv\Scripts\pip install -r backend\requirements.txt
```

### Step 5: Configuration

Create `C:\NMS\.env`:
```
DB_HOST=localhost
DB_PORT=3306
DB_USER=nms
DB_PASSWORD=your_secure_password
DB_NAME=nms

HOST=0.0.0.0
PORT=8000
DEBUG=false

SNMP_TIMEOUT=2
SNMP_RETRIES=1
METRICS_COLLECTION_INTERVAL=60
ICMP_CHECK_INTERVAL=30
ALERT_CHECK_INTERVAL=60
SCAN_CONCURRENCY=100
SCAN_PING_TIMEOUT=0.5
METRICS_RETENTION_DAYS=90
```

### Step 6: Run the Application

**Option A: Command line (for testing)**
```powershell
cd C:\NMS\backend
..\venv\Scripts\uvicorn.exe app.main:app --host 0.0.0.0 --port 8000
```

**Option B: Windows Service via NSSM (recommended for production)**
```powershell
# Install NSSM
winget install nssm

# Create service
nssm install NMS "C:\NMS\venv\Scripts\uvicorn.exe" "app.main:app --host 0.0.0.0 --port 8000 --workers 2 --log-level info"
nssm set NMS AppDirectory "C:\NMS\backend"
nssm set NMS DisplayName "NMS - Network Management System"
nssm set NMS Start SERVICE_AUTO_START

# Start the service
nssm start NMS
```

**Option C: Scheduled Task (fallback)**
```powershell
$action = New-ScheduledTaskAction -Execute "C:\NMS\venv\Scripts\uvicorn.exe" `
    -Argument "app.main:app --host 0.0.0.0 --port 8000 --workers 2 --log-level info" `
    -WorkingDirectory "C:\NMS\backend"

$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -StartWhenAvailable -RestartCount 5

Register-ScheduledTask -TaskName "NMS-NetworkManagementSystem" `
    -Action $action -Trigger $trigger -Principal $principal -Settings $settings
```

### Step 7: Configure Windows Firewall

```powershell
New-NetFirewallRule -DisplayName "NMS Web Interface" `
    -Direction Inbound -Protocol TCP -LocalPort 8000 `
    -Action Allow -Profile Any
```

### Step 8: Verify

1. Open browser to `http://localhost:8000`
2. The NMS dashboard should load
3. Check `http://localhost:8000/docs` for API documentation
4. Check `http://localhost:8000/api/health` for health status

---

## Post-Installation

### Access the Application

| URL | Description |
|-----|-------------|
| `http://localhost:8000` | Main NMS web interface |
| `http://localhost:8000/docs` | Swagger API documentation |
| `http://localhost:8000/redoc` | ReDoc API documentation |
| `http://localhost:8000/api/health` | Health check endpoint |

### First Steps

1. Open the NMS web interface
2. Navigate to **Device Discovery**
3. Enter your network range (e.g., `192.168.1.0/24`)
4. Click **Start Scan**
5. Review discovered devices and approve those you want to manage
6. Navigate to the **Dashboard** to see device status and metrics
7. Set up **Alert Rules** for critical metrics

### Service Management (Linux)

```bash
sudo systemctl start nms       # Start the service
sudo systemctl stop nms        # Stop the service
sudo systemctl restart nms     # Restart the service
sudo systemctl status nms      # Check status
sudo journalctl -u nms -f      # Follow logs
sudo journalctl -u nms -n 100  # Last 100 log lines
```

### Service Management (Windows)

**Using NSSM:**
```powershell
nssm start NMS
nssm stop NMS
nssm restart NMS
nssm status NMS
```

**Using Scheduled Task:**
```powershell
Start-ScheduledTask -TaskName "NMS-NetworkManagementSystem"
Stop-ScheduledTask -TaskName "NMS-NetworkManagementSystem"
Get-ScheduledTask -TaskName "NMS-NetworkManagementSystem"
```

---

## Production Hardening

### 1. Use Nginx as a Reverse Proxy

```bash
# Copy the provided Nginx config
sudo cp native/nginx.conf /etc/nginx/sites-available/nms.conf
sudo ln -sf /etc/nginx/sites-available/nms.conf /etc/nginx/sites-enabled/nms.conf

# Test and reload
sudo nginx -t
sudo systemctl reload nginx
```

### 2. Enable HTTPS with Let's Encrypt

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d nms.example.com

# Auto-renewal is configured automatically
```

### 3. Database Optimization

Add the following to MySQL configuration (`/etc/mysql/mysql.conf.d/mysqld.cnf` or `/etc/my.cnf`):

```ini
[mysqld]
# NMS optimization
innodb_buffer_pool_size = 512M
innodb_log_file_size = 256M
innodb_flush_log_at_trx_commit = 2
innodb_flush_method = O_DIRECT
max_connections = 200

# Time-series data optimization
table_open_cache = 2000
table_definition_cache = 2000
```

### 4. Data Retention & Cleanup

Set up a cron job to clean up old metrics:

```bash
# Run daily at 3 AM to delete metrics older than retention period
0 3 * * * mysql -u nms -p'password' nms -e "DELETE FROM device_metrics WHERE collected_at < DATE_SUB(NOW(), INTERVAL 90 DAY);" && \
          mysql -u nms -p'password' nms -e "DELETE FROM interface_metrics WHERE collected_at < DATE_SUB(NOW(), INTERVAL 90 DAY);" && \
          mysql -u nms -p'password' nms -e "OPTIMIZE TABLE device_metrics, interface_metrics;"
```

### 5. Increase Worker Count

Edit the systemd service file or startup command to match CPU cores:

```bash
# In nms.service, change --workers:
ExecStart=/opt/nms/venv/bin/uvicorn app.main:app --host ${HOST} --port ${PORT} --workers $(nproc) --log-level info
```

### 6. Security Checklist

- [ ] Change default database password (auto-generated passwords are printed during install)
- [ ] Set up firewall rules to restrict access to port 8000
- [ ] Use Nginx with HTTPS in production
- [ ] Restrict MySQL to listen only on localhost (`bind-address = 127.0.0.1`)
- [ ] Set `DEBUG=false` in `.env`
- [ ] Regularly back up the MySQL database
- [ ] Keep Python packages updated

---

## Upgrading

### Linux

```bash
# 1. Stop the service
sudo systemctl stop nms

# 2. Back up the database
mysqldump -u nms -p nms > nms_backup_$(date +%Y%m%d).sql

# 3. Update application files
sudo cp -r backend/* /opt/nms/backend/
sudo cp -r frontend/* /opt/nms/frontend/

# 4. Update Python dependencies
cd /opt/nms
sudo ./venv/bin/pip install -r backend/requirements.txt --upgrade

# 5. Restart the service
sudo systemctl start nms
```

### Windows

```powershell
# 1. Stop the service
nssm stop NMS
# Or: Stop-ScheduledTask -TaskName "NMS-NetworkManagementSystem"

# 2. Back up the database
mysqldump -u nms -p nms > nms_backup_$(Get-Date -Format yyyyMMdd).sql

# 3. Update files
Copy-Item -Recurse -Force backend\* C:\NMS\backend\
Copy-Item -Recurse -Force frontend\* C:\NMS\frontend\

# 4. Update dependencies
C:\NMS\venv\Scripts\pip.exe install -r C:\NMS\backend\requirements.txt --upgrade

# 5. Restart
nssm start NMS
```

---

## Troubleshooting

### NMS fails to start

```bash
# Check logs
sudo journalctl -u nms -n 50 --no-pager

# Common issues:
# - MySQL not running
# - Wrong database credentials in .env
# - Port already in use
# - Missing Python dependencies

# Test MySQL connection
mysql -u nms -p -h localhost nms -e "SELECT 1"

# Test Python environment
cd /opt/nms && sudo -u nms ./venv/bin/python -c "from app.main import app; print('OK')"
```

### ICMP/SNMP discovery not working

- **ICMP**: Ensure the system has permission for raw sockets. On Linux, `ping3` needs `CAP_NET_RAW`:
  ```bash
  sudo setcap cap_net_raw+ep /opt/nms/venv/bin/python3
  ```
- **SNMP**: Verify target devices have SNMP enabled and the community string is correct.
  ```bash
  snmpwalk -v2c -c public <device_ip> 1.3.6.1.2.1.1
  ```

### WebSocket connection fails behind proxy

Ensure the proxy passes `Upgrade` and `Connection` headers. See `native/nginx.conf` for correct Nginx configuration.

### Database connection errors

```bash
# Verify MySQL is accepting connections
sudo netstat -tlnp | grep 3306

# Check MySQL error log
sudo tail -f /var/log/mysql/error.log

# Reset user permissions if needed
mysql -u root -p -e "ALTER USER 'nms'@'localhost' IDENTIFIED BY 'new_password'; FLUSH PRIVILEGES;"
```

### Port already in use

```bash
# Find what's using the port
sudo lsof -i :8000          # Linux
netstat -ano | findstr 8000 # Windows

# Change the port in .env and restart
```

---

## Directory Structure (After Installation)

```
/opt/nms/                        (Linux) or C:\NMS\ (Windows)
├── .env                         # Environment configuration
├── credentials.txt              # Database credentials (protected)
├── venv/                        # Python virtual environment
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI entry point
│   │   ├── config.py            # Configuration loader
│   │   ├── database.py          # SQLAlchemy setup
│   │   ├── models/              # Database models
│   │   ├── routers/             # API routes
│   │   ├── services/            # Background services
│   │   ├── websocket/           # WebSocket manager
│   │   └── utils/               # Utilities
│   └── requirements.txt
├── frontend/
│   ├── index.html               # SPA entry point
│   ├── css/                     # Stylesheets
│   └── js/                      # JavaScript modules
└── logs/                        # Application logs (Windows)
```
