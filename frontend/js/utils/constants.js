/**
 * Application constants for NMS.
 */
const CONSTANTS = {
    // Device type labels and icons
    DEVICE_TYPES: {
        router:      { label: 'Router',      icon: 'fa-route',         color: '#4361ee' },
        switch_:     { label: 'Switch',       icon: 'fa-code-branch',   color: '#3a0ca3' },
        firewall:    { label: 'Firewall',     icon: 'fa-shield-haltered', color: '#e74c3c' },
        server_linux:  { label: 'Linux Server',  icon: 'fa-server',         color: '#2ecc71' },
        server_windows:{ label: 'Windows Server',icon: 'fa-server',         color: '#3498db' },
        other:       { label: 'Other',        icon: 'fa-question-circle', color: '#95a5a6' },
    },

    // Metric type labels and colors
    METRIC_TYPES: {
        cpu:      { label: 'CPU',       unit: '%',   color: '#4361ee', max: 100 },
        memory:   { label: 'Memory',    unit: '%',   color: '#7209b7', max: 100 },
        disk:     { label: 'Disk',      unit: '%',   color: '#f72585', max: 100 },
        network:  { label: 'Network',   unit: 'bps', color: '#4cc9f0', max: null },
    },

    // Chart color palette
    CHART_COLORS: [
        '#4361ee', '#7209b7', '#f72585', '#4cc9f0',
        '#2ecc71', '#f39c12', '#e74c3c', '#1abc9c',
        '#9b59b6', '#34495e', '#e67e22', '#3498db',
    ],

    // Device status colors
    STATUS_COLORS: {
        online:  '#2ecc71',
        offline: '#e74c3c',
        warning: '#f39c12',
        unknown: '#95a5a6',
    },

    // Alert severity colors
    SEVERITY_COLORS: {
        info:     '#3498db',
        warning:  '#f39c12',
        critical: '#e74c3c',
    },

    // Interface types
    IF_TYPES: {
        6: 'Ethernet',
        7: 'Ethernet',
        24: 'Loopback',
        53: 'VLAN',
        117: 'GigabitEthernet',
        161: 'LAG',
    },

    // Default chart options for time-series
    CHART_DEFAULTS: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
            legend: {
                position: 'bottom',
                labels: { usePointStyle: true, padding: 16, boxWidth: 8 },
            },
        },
        scales: {
            x: {
                grid: { display: false },
                ticks: { maxTicksLimit: 10 },
            },
            y: {
                beginAtZero: true,
                grid: { color: '#f0f0f0' },
            },
        },
    },

    // Polling intervals (ms)
    POLLING: {
        DEVICE_LIST: 10000,
        METRICS: 15000,
        ALERTS: 15000,
    },

    // Context menu items by page
    CONTEXT_MENUS: {
        topology_device: [
            { label: 'Rename',          icon: 'fa-i-cursor',   action: 'rename' },
            { label: 'Change Icon',     icon: 'fa-icons',      action: 'change_icon' },
            { label: 'Edit Details',    icon: 'fa-edit',       action: 'edit' },
            { label: 'Remove from Map', icon: 'fa-trash',      action: 'delete' },
            { type: 'separator' },
            { label: 'SSH Connect',     icon: 'fa-terminal',   action: 'ssh' },
            { label: 'RDP Connect',     icon: 'fa-desktop',    action: 'rdp' },
            { label: 'Web Interface',   icon: 'fa-globe',      action: 'web' },
            { type: 'separator' },
            { label: 'View Dashboard',  icon: 'fa-chart-line', action: 'dashboard' },
        ],
        topology_manual: [
            { label: 'Rename',      icon: 'fa-i-cursor',   action: 'rename' },
            { label: 'Edit',        icon: 'fa-edit',       action: 'edit' },
            { label: 'Delete',      icon: 'fa-trash',      action: 'delete' },
        ],
        topology_edge: [
            { label: 'Edit Label',      icon: 'fa-tag',         action: 'edit_edge' },
            { label: 'Line Style',      icon: 'fa-paintbrush',  action: 'edge_style' },
            { label: 'Port Names',      icon: 'fa-plug',        action: 'edge_ports' },
            { type: 'separator' },
            { label: 'Delete',          icon: 'fa-trash',       action: 'delete_edge' },
        ],
        topology_note: [
            { label: 'Edit',            icon: 'fa-edit',       action: 'note_edit' },
            { label: 'Copy',            icon: 'fa-copy',       action: 'note_copy' },
            { type: 'separator' },
            { label: 'Delete',          icon: 'fa-trash',      action: 'note_delete' },
        ],
        rack_device: [
            { label: 'Edit Device',    icon: 'fa-edit',       action: 'edit' },
            { label: 'Remove from Rack', icon: 'fa-trash',    action: 'remove' },
            { type: 'separator' },
            { label: 'SSH Connect',    icon: 'fa-terminal',   action: 'ssh' },
            { label: 'RDP Connect',    icon: 'fa-desktop',    action: 'rdp' },
            { label: 'Web Interface',  icon: 'fa-globe',      action: 'web' },
            { type: 'separator' },
            { label: 'View Dashboard', icon: 'fa-chart-line', action: 'dashboard' },
        ],
    },
};
