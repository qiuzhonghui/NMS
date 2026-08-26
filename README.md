# NMS - Network Management System

A comprehensive, B/S-architecture Network Management System inspired by Zabbix and Prometheus. Built with Python/FastAPI backend and vanilla JavaScript frontend, supporting real-time monitoring via WebSocket and MySQL for data storage.

## Features

### 1. Network Device Discovery
- **Manual network scanning**: Enter CIDR ranges (e.g., `192.168.1.0/24`) or IP ranges (e.g., `10.0.0.0-200`) to automatically scan the network
- **ICMP host discovery**: Detects live hosts via ICMP ping and TCP port probing
- **SNMP device discovery**: Identifies SNMP-enabled devices and detects vendor/type (Cisco, Juniper, HP, Linux, Windows, etc.)
- **Approval workflow**: Review discovered devices and selectively approve them for management

### 2. Real-Time Dashboard & Monitoring
- **Device status overview**: At-a-glance view of all managed devices (online/offline/warning)
- **Real-time metrics**: CPU, memory, disk, and network utilization collected via SNMP
- **Historical charts**: Time-series charts built with Chart.js for trend analysis
- **Live WebSocket updates**: Metric changes and device status transitions pushed in real-time
- **Per-device detail pages**: Deep-dive into individual device metrics, interfaces, and front panel

### 3. Custom Device Front Panels
- **Front panel designer**: Create custom faceplate layouts for any device model
- **Port status visualization**: Green (UP) / Gray (DOWN) port indicators updated via SNMP
- **HTML5 Canvas rendering**: Interactive port hover/click for detailed interface information
- **Multiple port types**: RJ45, SFP, SFP+, QSFP, Console, Power, etc.

### 4. Interactive Network Topology
- **Auto-discovery**: CDP/LLDP neighbor discovery via SNMP for automatic topology mapping
- **Manual editing**: Add, modify, or delete nodes and edges — manual changes always take priority over auto-discovery
- **vis-network canvas**: Drag-and-drop interactive network map with physics layout
- **Right-click context menu**: Edit/delete elements, SSH/RDP/Web remote access, jump to device dashboard
- **Custom annotations**: Add text labels, images, and free-form nodes

### 5. Rack View
- **Custom rack management**: Create racks with configurable height (RU) and width
- **Device placement**: Assign managed devices to specific rack positions (RU-based)
- **Visual rack layout**: Front-view rack rendering with numbered RU markings
- **Right-click context menu**: Quick access to device edit/monitor/remote operations from rack view

### 6. Alerting
- **Configurable alert rules**: Define thresholds for any metric (CPU > 90%, memory < 10%, etc.)
- **Severity levels**: Info, Warning, Critical
- **Alert lifecycle**: Triggered → Acknowledged → Resolved
- **Real-time notifications**: WebSocket push notifications for triggered alerts
- **Per-device or global rules**: Apply rules to specific devices or all devices

## Architecture

```
Browser (SPA)
    │
    ├── REST API (FastAPI) ── MySQL 8.0
    │
    ├── WebSocket (FastAPI) ── Real-time updates
    │
    └── Background Services
        ├── SNMP Collector (pysnmp)
        ├── ICMP Monitor (ping3)
        ├── Network Scanner (ICMP + SNMP)
        ├── Topology Discovery (CDP/LLDP)
        └── Alert Engine
```

### Tech Stack

| Component | Technology |
|-----------|-----------|
| **Backend** | Python 3.11+ / FastAPI (async) |
| **Frontend** | Vanilla JS + Chart.js + vis-network |
| **Database** | MySQL 8.0 + SQLAlchemy 2.0 (async) |
| **Real-time** | WebSocket (FastAPI built-in) |
| **SNMP** | pysnmp 6.x (v1/v2c/v3) |
| **ICMP** | ping3 |
| **Charts** | Chart.js 4.x |
| **Topology** | vis-network 9.x |
| **Icons** | Font Awesome 6.x |

## Deployment

NMS uses a unified management script for deployment:

```bash
# Interactive menu — choose Install/Uninstall/Deploy/Status/Verify
sudo bash native/nms.sh

# Or directly:
sudo bash native/nms.sh install      # Fresh install
sudo bash native/nms.sh deploy       # Sync changed files
sudo bash native/nms.sh status       # Show status
sudo bash native/nms.sh verify       # Check deployment integrity
```

See the [Native Deployment Guide](native/NATIVE_DEPLOYMENT.md) for detailed instructions.

## Manual Installation

### Prerequisites
- Python 3.11 or higher
- MySQL 8.0
- pip (Python package manager)

### Backend Setup

```bash
# 1. Create MySQL database
mysql -u root -p
CREATE DATABASE nms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'nms'@'localhost' IDENTIFIED BY 'nms_password';
GRANT ALL PRIVILEGES ON nms.* TO 'nms'@'localhost';
FLUSH PRIVILEGES;
EXIT;

# 2. Set environment variables (or edit .env file)
export DB_HOST=localhost
export DB_PORT=3306
export DB_USER=nms
export DB_PASSWORD=nms_password
export DB_NAME=nms

# 3. Install Python dependencies
cd backend
pip install -r requirements.txt

# 4. Run the application
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Access

Open your browser to `http://localhost:8000`

## Configuration

All configuration is done via environment variables (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `localhost` | MySQL host |
| `DB_PORT` | `3306` | MySQL port |
| `DB_USER` | `nms` | MySQL user |
| `DB_PASSWORD` | `nms_password` | MySQL password |
| `DB_NAME` | `nms` | Database name |
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `8000` | Server port |
| `DEBUG` | `false` | Enable debug mode |
| `SNMP_TIMEOUT` | `2` | SNMP request timeout (seconds) |
| `SNMP_RETRIES` | `1` | SNMP retry count |
| `METRICS_COLLECTION_INTERVAL` | `60` | SNMP polling interval (seconds) |
| `ICMP_CHECK_INTERVAL` | `30` | ICMP ping interval (seconds) |
| `ALERT_CHECK_INTERVAL` | `60` | Alert evaluation interval (seconds) |
| `SCAN_CONCURRENCY` | `100` | Max concurrent scan targets |
| `SCAN_PING_TIMEOUT` | `0.5` | Per-ping timeout during scan (seconds) |
| `METRICS_RETENTION_DAYS` | `90` | Days to retain metric data |

## Usage Guide

### 1. Discovering Devices

1. Navigate to **Device Discovery** in the sidebar
2. Enter network ranges in the text box (supports multiple formats):
   - CIDR: `192.168.1.0/24`
   - IP range: `10.0.0.1-10.0.0.50` or `10.0.0.0-200`
   - Comma-separated: `192.168.1.0/24, 10.0.0.0/24`
3. Optionally specify SNMP community strings (default: `public`)
4. Click **Start Scan**
5. Review discovered devices and click **Approve** to add them to management
6. When approving, configure:
   - Device name
   - Device type (router, switch, firewall, Linux/Windows server)
   - SNMP community string (if SNMP is available)

### 2. Viewing the Dashboard

- The **Dashboard** shows all managed devices with status indicators
- Each device card displays mini CPU and memory charts
- Click a device name to go to its detail page
- Status indicators: 🟢 Online, 🟠 Warning, 🔴 Offline

### 3. Monitoring a Device

On the **Device Detail** page:
- View real-time CPU, Memory, Network, and Disk charts
- See all network interfaces with status (UP/DOWN) and speed
- View the front panel with live port status (if configured)
- Historical data is available via the time-series charts

### 4. Network Topology

- Navigate to **Topology**
- The canvas shows all managed devices as nodes
- **Auto-Discover (CDP/LLDP)**: Click to discover network neighbors via SNMP
- **Add Node**: Manually add custom nodes (text labels, images)
- **Right-click** on any node to:
  - Edit/Delete the element
  - SSH/RDP/Web remote connection
  - Jump to the device dashboard
- **Double-click** a device node to open its detail page
- Drag nodes to rearrange the topology

### 5. Rack Management

- Navigate to **Rack View**
- Click **Add Rack** to create a rack (specify name, location, height in RU)
- Click a rack to view its detail
- Click **Place Device** to assign a managed device to a rack position
- Each device in the rack shows its type, status, and RU position
- **Right-click** on a rack device for the context menu

### 6. Alert Configuration

- Navigate to **Alerts** → **Alert Rules** tab
- Click **Add Rule** to create a new alert rule:
  - Select metric type (CPU/Memory/Disk/Network)
  - Configure condition (>, <, >=, <=, ==) and threshold
  - Set severity (Info/Warning/Critical)
- The **Alert History** tab shows triggered alerts
- Click **Ack** to acknowledge an alert

## API Documentation

Once the application is running, interactive API documentation is available at:
- **Swagger UI**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`

### Key API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/discovery/scan` | Start network scan |
| GET  | `/api/discovery/devices` | List discovered devices |
| POST | `/api/discovery/devices/{id}/approve` | Approve and add device |
| GET  | `/api/devices` | List managed devices |
| GET  | `/api/devices/{id}` | Get device details |
| GET  | `/api/devices/{id}/metrics` | Get device metrics |
| GET  | `/api/devices/{id}/interfaces` | Get device interfaces |
| GET  | `/api/topology` | Get topology graph |
| POST | `/api/topology/discover` | Run CDP/LLDP discovery |
| GET  | `/api/racks` | List racks |
| POST | `/api/racks/{id}/devices` | Place device in rack |
| GET  | `/api/alerts/rules` | List alert rules |
| POST | `/api/alerts/rules` | Create alert rule |
| GET  | `/api/alerts` | List triggered alerts |
| GET  | `/api/front-panels` | List front panels |

### WebSocket (`/ws`)

Connect via WebSocket for real-time updates:

```javascript
const ws = new WebSocket('ws://localhost:8000/ws');

// Subscribe to a device's metrics
ws.send(JSON.stringify({
    action: 'subscribe_device',
    device_id: 'abc123'
}));

// Receive metric updates
ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    // data.event: 'metric_update', 'device_status', 'alert', etc.
};
```

Events received:
- `metric_update` — Latest device metric values
- `device_status` — Device online/offline/warning status change
- `interface_status` — Interface up/down change
- `alert` — New alert triggered
- `scan_progress` — Discovery scan progress updates
- `scan_complete` — Discovery scan finished
- `device_added` / `device_removed` — Device management changes

## SNMP Support

The system supports SNMP v1, v2c, and v3 for:
- **System information**: Hostname, description, uptime
- **CPU metrics**: User, system, idle, nice percentages (UCD-SNMP-MIB)
- **Memory metrics**: Total, available, swap, buffer, cache
- **Disk metrics**: Total, used, available per filesystem
- **Interface metrics**: Traffic (in/out octets), errors, discards, status
- **CDP/LLDP**: Neighbor discovery for topology mapping
- **Vendor detection**: Automatically identifies Cisco, Juniper, HP, Dell, Fortinet, etc.

Supported vendor OIDs include Cisco, HP/HPE, Juniper, Huawei, H3C, Dell, IBM, Fortinet, F5, CheckPoint, MikroTik, NetApp, and more.

## Database Schema

The application uses 12 core tables:

| Table | Description |
|-------|-------------|
| `devices` | Managed network devices and hosts |
| `discovered_devices` | Auto-discovered devices pending approval |
| `device_metrics` | Time-series metric data (CPU, memory, disk, network) |
| `device_interfaces` | Network interfaces per device |
| `interface_metrics` | Interface traffic statistics over time |
| `front_panels` | Custom device faceplate templates |
| `front_panel_ports` | Port positions and types on front panels |
| `topology_nodes` | Topology map nodes (devices and annotations) |
| `topology_edges` | Connections between topology nodes |
| `racks` | Server/network rack definitions |
| `rack_devices` | Device placement in racks (RU position) |
| `alert_rules` | Alert threshold rules |
| `alerts` | Triggered alert instances |

Tables are auto-created on first startup. For production, use Alembic migrations.

## Directory Structure

```
NMS/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI entry point
│   │   ├── config.py            # Environment configuration
│   │   ├── database.py          # SQLAlchemy engine & session
│   │   ├── models/              # ORM models (12 tables)
│   │   ├── routers/             # REST API routes (8 modules)
│   │   ├── services/            # Business logic (scanner, collector, etc.)
│   │   ├── websocket/           # WebSocket connection manager
│   │   └── utils/               # CIDR parser, SNMP helpers
│   └── requirements.txt
├── frontend/
│   ├── index.html               # SPA entry point
│   ├── css/                     # Stylesheets (5 files)
│   └── js/
│       ├── app.js               # SPA router & shell
│       ├── api.js               # REST API client
│       ├── websocket.js         # WebSocket client
│       ├── pages/               # Page modules (7 pages)
│       ├── components/          # Reusable UI components (5)
│       └── utils/               # Formatting & constants
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── README.md
```

## License

MIT License
