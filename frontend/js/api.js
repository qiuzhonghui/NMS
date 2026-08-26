/**
 * REST API client for NMS backend.
 */
const API = {
    BASE: '/api',

    /**
     * Build query string, skipping null/undefined/empty values.
     */
    _qs(params) {
        const clean = {};
        for (const [k, v] of Object.entries(params)) {
            if (v !== null && v !== undefined && v !== '') {
                clean[k] = v;
            }
        }
        const qs = new URLSearchParams(clean).toString();
        return qs ? '?' + qs : '';
    },

    /**
     * Parse FastAPI error response into a human-readable string.
     * FastAPI returns format: {"detail": "message"} or {"detail": [{...}, ...]}
     */
    _parseError(res, body) {
        if (!body) return `HTTP ${res.status} ${res.statusText}`;

        let detail = body.detail;
        if (!detail) return `HTTP ${res.status} ${res.statusText}`;

        // FastAPI validation errors: detail is an array of {loc, msg, type}
        if (Array.isArray(detail)) {
            return detail.map(d => {
                const field = (d.loc || []).filter(l => l !== 'body').join('.') || 'request';
                return `${field}: ${d.msg}`;
            }).join('; ');
        }

        // Plain string detail
        return String(detail);
    },

    /**
     * Generic GET request.
     */
    async get(path) {
        const res = await fetch(`${this.BASE}${path}`);
        if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(this._parseError(res, body));
        }
        return res.json();
    },

    /**
     * Generic POST request.
     */
    async post(path, data) {
        const res = await fetch(`${this.BASE}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(this._parseError(res, body));
        }
        return res.json();
    },

    /**
     * Generic PUT request.
     */
    async put(path, data) {
        const res = await fetch(`${this.BASE}${path}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(this._parseError(res, body));
        }
        return res.json();
    },

    /**
     * Generic DELETE request.
     */
    async del(path) {
        const res = await fetch(`${this.BASE}${path}`, {
            method: 'DELETE',
        });
        if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(this._parseError(res, body));
        }
        return res.json();
    },

    // ─── Discovery ───────────────────────────────────────────

    /** Start a network scan. */
    scanNetwork(ranges, snmpCommunities = ['public'], concurrency = 50) {
        return this.post('/discovery/scan', {
            ranges,
            snmp_communities: snmpCommunities,
            scan_type: 'both',
            concurrency: concurrency,
        });
    },

    /** Get scan progress. */
    getScanStatus(scanId) {
        return this.get(`/discovery/status/${scanId}`);
    },

    /** List discovered devices. */
    getDiscoveredDevices() {
        return this.get('/discovery/devices');
    },

    /** Approve a discovered device. */
    approveDevice(deviceId, config = {}) {
        return this.post(`/discovery/devices/${deviceId}/approve`, config);
    },

    /** Delete a discovered device. */
    deleteDiscoveredDevice(deviceId) {
        return this.del(`/discovery/devices/${deviceId}`);
    },

    // ─── Devices ─────────────────────────────────────────────

    /** List all managed devices. */
    getDevices(filters = {}) {
        return this.get(`/devices${this._qs(filters)}`);
    },

    /** Get a single device's details. */
    getDevice(deviceId) {
        return this.get(`/devices/${deviceId}`);
    },

    /** Update a device. */
    updateDevice(deviceId, data) {
        return this.put(`/devices/${deviceId}`, data);
    },

    /** Delete a device. */
    deleteDevice(deviceId) {
        return this.del(`/devices/${deviceId}`);
    },

    /** Get device metrics history. */
    getDeviceMetrics(deviceId, params = {}) {
        return this.get(`/devices/${deviceId}/metrics${this._qs(params)}`);
    },

    /** Get device interfaces. */
    getDeviceInterfaces(deviceId) {
        return this.get(`/devices/${deviceId}/interfaces`);
    },

    // ─── Metrics ─────────────────────────────────────────────

    /** Get latest metrics for devices. */
    getLatestMetrics(deviceIds = []) {
        const ids = deviceIds.join(',');
        return this.get(`/metrics/latest${ids ? '?device_ids=' + ids : ''}`);
    },

    /** Get interface traffic metrics. */
    getInterfaceMetrics(interfaceId, params = {}) {
        return this.get(`/metrics/interfaces/${interfaceId}${this._qs(params)}`);
    },

    // ─── Topology ────────────────────────────────────────────

    /** Get full topology graph. */
    getTopology() {
        return this.get('/topology');
    },

    /** Add a node. */
    addTopologyNode(data) {
        return this.post('/topology/nodes', data);
    },

    /** Update a node. */
    updateTopologyNode(nodeId, data) {
        return this.put(`/topology/nodes/${nodeId}`, data);
    },

    /** Delete a node. */
    deleteTopologyNode(nodeId) {
        return this.del(`/topology/nodes/${nodeId}`);
    },

    /** Add an edge. */
    addTopologyEdge(data) {
        return this.post('/topology/edges', data);
    },

    /** Update an edge. */
    updateTopologyEdge(edgeId, data) {
        return this.put(`/topology/edges/${edgeId}`, data);
    },

    /** Delete an edge. */
    deleteTopologyEdge(edgeId) {
        return this.del(`/topology/edges/${edgeId}`);
    },

    /** Run topology discovery. */
    runTopologyDiscovery() {
        return this.post('/topology/discover');
    },

    // ─── Racks ───────────────────────────────────────────────

    /** List racks. */
    getRacks() {
        return this.get('/racks');
    },

    /** Create a rack. */
    createRack(data) {
        return this.post('/racks', data);
    },

    /** Update a rack. */
    updateRack(rackId, data) {
        return this.put(`/racks/${rackId}`, data);
    },

    /** Delete a rack. */
    deleteRack(rackId) {
        return this.del(`/racks/${rackId}`);
    },

    /** Get devices in a rack. */
    getRackDevices(rackId) {
        return this.get(`/racks/${rackId}/devices`);
    },

    /** Place device in rack. */
    placeDeviceInRack(rackId, data) {
        return this.post(`/racks/${rackId}/devices`, data);
    },

    /** Move device in rack. */
    moveDeviceInRack(rackId, deviceId, data) {
        return this.put(`/racks/${rackId}/devices/${deviceId}`, data);
    },

    /** Remove device from rack. */
    removeDeviceFromRack(rackId, deviceId) {
        return this.del(`/racks/${rackId}/devices/${deviceId}`);
    },

    // ─── Front Panels ────────────────────────────────────────

    /** List front panels. */
    getFrontPanels() {
        return this.get('/front-panels');
    },

    /** Create a front panel. */
    createFrontPanel(data) {
        return this.post('/front-panels', data);
    },

    /** Update a front panel. */
    updateFrontPanel(panelId, data) {
        return this.put(`/front-panels/${panelId}`, data);
    },

    /** Delete a front panel. */
    deleteFrontPanel(panelId) {
        return this.del(`/front-panels/${panelId}`);
    },

    /** Get ports on a front panel. */
    getFrontPanelPorts(panelId) {
        return this.get(`/front-panels/${panelId}/ports`);
    },

    /** Add a port. */
    addFrontPanelPort(panelId, data) {
        return this.post(`/front-panels/${panelId}/ports`, data);
    },

    /** Update a port. */
    updateFrontPanelPort(panelId, portId, data) {
        return this.put(`/front-panels/${panelId}/ports/${portId}`, data);
    },

    /** Delete a port. */
    deleteFrontPanelPort(panelId, portId) {
        return this.del(`/front-panels/${panelId}/ports/${portId}`);
    },

    // ─── Alerts ──────────────────────────────────────────────

    /** List alert rules. */
    getAlertRules(deviceId = null) {
        return this.get(`/alerts/rules${this._qs({ device_id: deviceId })}`);
    },

    /** Create an alert rule. */
    createAlertRule(data) {
        return this.post('/alerts/rules', data);
    },

    /** Update an alert rule. */
    updateAlertRule(ruleId, data) {
        return this.put(`/alerts/rules/${ruleId}`, data);
    },

    /** Delete an alert rule. */
    deleteAlertRule(ruleId) {
        return this.del(`/alerts/rules/${ruleId}`);
    },

    /** List alerts. */
    getAlerts(params = {}) {
        return this.get(`/alerts${this._qs(params)}`);
    },

    /** Acknowledge an alert. */
    acknowledgeAlert(alertId) {
        return this.post(`/alerts/${alertId}/acknowledge`);
    },

    // ─── Device Models ───────────────────────────────────────

    /** List device models. */
    getDeviceModels(filters = {}) {
        return this.get(`/device-models${this._qs(filters)}`);
    },

    /** Seed predefined device models. */
    seedDeviceModels(overwrite = false) {
        return this.post('/device-models/seed', { overwrite });
    },

    /** Create a device model. */
    createDeviceModel(data) {
        return this.post('/device-models', data);
    },

    /** List vendors. */
    getVendors() {
        return this.get('/device-models/vendors');
    },

    // ─── Templates ────────────────────────────────────────────

    /** List monitoring templates. */
    getTemplates(deviceModelId = null) {
        return this.get(`/templates${this._qs({ device_model_id: deviceModelId })}`);
    },

    /** Create a template. */
    createTemplate(data) {
        return this.post('/templates', data);
    },

    /** Delete a template. */
    deleteTemplate(templateId) {
        return this.del(`/templates/${templateId}`);
    },

    /** Get template items. */
    getTemplateItems(templateId) {
        return this.get(`/templates/${templateId}/items`);
    },

    /** Add item to template. */
    addTemplateItem(templateId, data) {
        return this.post(`/templates/${templateId}/items`, data);
    },

    /** Delete template item. */
    deleteTemplateItem(templateId, itemId) {
        return this.del(`/templates/${templateId}/items/${itemId}`);
    },

    /** Apply template to device. */
    applyTemplate(templateId, deviceId) {
        return this.post(`/templates/${templateId}/apply/${deviceId}`);
    },

    // ─── Zabbix Templates ──────────────────────────────────────

    /** List Zabbix repo template files (cached). */
    getZabbixRepoFiles(force = false) {
        return this.get(`/zabbix-templates/repo/files?force=${force}`);
    },

    /** Force refresh Zabbix repo cache (starts background scan). */
    refreshZabbixRepo() {
        return this.post('/zabbix-templates/repo/refresh');
    },

    /** Get current scan progress. */
    getZabbixRepoStatus() {
        return this.get('/zabbix-templates/repo/status');
    },

    /** Get raw YAML content of a Zabbix template file. */
    getZabbixTemplateContent(path) {
        return this.get(`/zabbix-templates/repo/file?path=${encodeURIComponent(path)}`);
    },

    /** Preview Zabbix template conversion. */
    previewZabbixTemplate(path) {
        return this.post('/zabbix-templates/preview', { path });
    },

    /** Import a Zabbix template into NMS. */
    importZabbixTemplate(path, templateName, selectedItems) {
        return this.post('/zabbix-templates/import', {
            path,
            template_name: templateName || null,
            selected_items: selectedItems || null,
        });
    },

    /** List previously imported Zabbix templates. */
    getZabbixImported() {
        return this.get('/zabbix-templates');
    },

    /** Delete an imported Zabbix template. */
    deleteZabbixImported(templateId) {
        return this.del(`/zabbix-templates/${templateId}`);
    },

    /** Get/Set proxy for Zabbix repo access. */
    getZabbixProxy() {
        return this.get('/zabbix-templates/repo/proxy');
    },

    setZabbixProxy(url) {
        return this.post('/zabbix-templates/repo/proxy', { url });
    },

    // ─── Manual Add Device ────────────────────────────────────

    /** Manually add a device. */
    manualAddDevice(data) {
        return this.post('/devices/manual-add', data);
    },

    // ─── Dashboards ───────────────────────────────────────────

    /** List dashboards. */
    getDashboards() {
        return this.get('/dashboards');
    },

    /** Create a dashboard. */
    createDashboard(data) {
        return this.post('/dashboards', data);
    },

    /** Get dashboard widgets. */
    getDashboardWidgets(dashboardId) {
        return this.get(`/dashboards/${dashboardId}/widgets`);
    },

    /** Create a widget. */
    createDashboardWidget(dashboardId, data) {
        return this.post(`/dashboards/${dashboardId}/widgets`, data);
    },

    /** Update a widget. */
    updateDashboardWidget(dashboardId, widgetId, data) {
        return this.put(`/dashboards/${dashboardId}/widgets/${widgetId}`, data);
    },

    /** Delete a widget. */
    deleteDashboardWidget(dashboardId, widgetId) {
        return this.del(`/dashboards/${dashboardId}/widgets/${widgetId}`);
    },

    /** Get aggregated dashboard data. */
    getDashboardData(dashboardId) {
        return this.get(`/dashboards/${dashboardId}/data`);
    },

    // ─── File Upload ────────────────────────────────────────────

    /** Upload a file via FormData. */
    async upload(path, formData) {
        const res = await fetch(`${this.BASE}${path}`, {
            method: 'POST',
            body: formData,
        });
        if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(this._parseError(res, body));
        }
        return res.json();
    },
};
