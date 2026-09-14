/**
 * Device Detail Page — single device metrics, interfaces, and front panel.
 */
const DeviceDetailPage = {
    deviceId: null,
    chartInstances: {},
    refreshTimer: null,

    async render(params) {
        this.deviceId = params[0];
        const container = document.getElementById('pageContainer');
        container.innerHTML = `
            <div class="page-header">
                <a href="#/devices" class="back-link"><i class="fas fa-arrow-left"></i> Back to Devices</a>
                <h2 id="deviceTitle">Device Details</h2>
                <div class="header-actions" id="deviceActions"></div>
            </div>
            <div id="deviceDetailContent"><div class="spinner"></div></div>
        `;

        await this.loadDevice();
    },

    destroy() {
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        this.refreshTimer = null;
        Object.values(this.chartInstances).forEach(c => c.destroy());
        this.chartInstances = {};
        NMS_WS.unsubscribeDevice(this.deviceId);
        if (this._boundMetricUpdate) NMS_WS.off('metric_update', this._boundMetricUpdate);
    },

    async loadDevice() {
        try {
            const device = await API.getDevice(this.deviceId);

            document.getElementById('deviceTitle').textContent = device.name;
            document.getElementById('deviceActions').innerHTML = `
                <span class="status-indicator status-${device.status}"></span>
                <span>${device.status.toUpperCase()}</span>
                <button class="btn btn-sm" onclick="DeviceDetailPage.editDevice()"><i class="fas fa-edit"></i> Edit</button>
                <button class="btn btn-sm" onclick="DeviceDetailPage.refresh()"><i class="fas fa-sync-alt"></i> Refresh</button>
            `;

            const content = document.getElementById('deviceDetailContent');
            content.innerHTML = `
                <!-- Device Info -->
                <div class="grid-4">
                    <div class="card info-card">
                        <strong>IP Address</strong>
                        <code>${Format.esc(device.ip_address)}</code>
                    </div>
                    <div class="card info-card">
                        <strong>Type</strong>
                        <span>${CONSTANTS.DEVICE_TYPES[device.device_type]?.label || device.device_type}</span>
                    </div>
                    <div class="card info-card">
                        <strong>Vendor / Model</strong>
                        <span>${Format.esc(device.vendor || '-')} ${Format.esc(device.model || '')}</span>
                    </div>
                    <div class="card info-card">
                        <strong>Remote Access</strong>
                        <span>
                            ${device.ssh_port ? `<span class="badge">SSH:${device.ssh_port}</span>` : ''}
                            ${device.rdp_port ? `<span class="badge">RDP:${device.rdp_port}</span>` : ''}
                            ${device.web_port ? `<span class="badge">Web:${device.web_port}</span>` : ''}
                        </span>
                    </div>
                </div>

                <!-- Ping Latency Chart -->
                <div id="pingTooltip" style="display:none;position:fixed;background:#1a1a2e;color:#fff;padding:4px 10px;border-radius:6px;font-size:12px;pointer-events:none;z-index:9999;white-space:nowrap;"></div>
                <div class="card" style="margin-top:20px;position:relative;">
                    <h4>ICMP Ping Latency</h4>
                    <div style="position:absolute;top:16px;right:20px;display:flex;align-items:center;gap:6px;z-index:5;">
                        <button class="ping-zoom-btn" onclick="DeviceDetailPage._zoomOut()" title="Zoom out">−</button>
                        <span id="pingRangeLabel" style="font-size:12px;font-weight:600;color:#4361ee;min-width:40px;text-align:center;">30m</span>
                        <button class="ping-zoom-btn" onclick="DeviceDetailPage._zoomIn()" title="Zoom in">+</button>
                    </div>
                    <div class="chart-container" style="height:120px;"><canvas id="pingDetailChart"></canvas></div>
                    <div id="pingStatusBar" style="margin-top:8px;height:14px;border-radius:7px;overflow:hidden;display:flex;background:#eee;cursor:pointer;"></div>
                </div>

                <!-- Metric Charts -->
                <div class="grid-2" style="margin-top:20px;">
                    <div class="card">
                        <h4>CPU Usage</h4>
                        <div class="chart-container"><canvas id="cpuDetailChart"></canvas></div>
                    </div>
                    <div class="card">
                        <h4>Memory Usage</h4>
                        <div class="chart-container"><canvas id="memDetailChart"></canvas></div>
                    </div>
                    <div class="card">
                        <h4>Network Traffic</h4>
                        <div class="chart-container"><canvas id="netDetailChart"></canvas></div>
                    </div>
                    <div class="card">
                        <h4>Disk Usage</h4>
                        <div class="chart-container"><canvas id="diskDetailChart"></canvas></div>
                    </div>
                </div>

                <!-- Interfaces -->
                <div class="card" style="margin-top:20px;">
                    <h4>Network Interfaces</h4>
                    <div id="deviceInterfaces"><div class="spinner"></div></div>
                </div>

                <!-- Front Panel -->
                <div class="card" id="frontPanelSection" style="margin-top:20px;display:none;">
                    <h4>Device Front Panel</h4>
                    <div id="frontPanelContainer"></div>
                </div>
            `;

            // Subscribe to real-time updates
            NMS_WS.subscribeDevice(this.deviceId);

            // Load metrics and draw charts
            await Promise.all([
                this._loadAndDraw('cpuDetailChart', 'cpu', 'CPU %', CONSTANTS.METRIC_TYPES.cpu.color),
                this._loadAndDraw('memDetailChart', 'memory', 'Memory %', CONSTANTS.METRIC_TYPES.memory.color),
                this._loadAndDraw('netDetailChart', 'network', 'Network', CONSTANTS.METRIC_TYPES.network.color),
                this._loadAndDraw('diskDetailChart', 'disk', 'Disk %', CONSTANTS.METRIC_TYPES.disk.color),
                this.loadInterfaces(),
                this._loadPingChart(),
            ]);

            // Show front panel if device has one
            if (device.front_panel_id) {
                document.getElementById('frontPanelSection').style.display = 'block';
                FrontPanel.render(device.front_panel_id, document.getElementById('frontPanelContainer'));
            }

            // Listen for real-time metric updates
            // Listen for real-time metric updates — refresh charts in place
            this._boundMetricUpdate = this._onMetricUpdate.bind(this);
            NMS_WS.on('metric_update', this._boundMetricUpdate);

            // Periodic chart refresh (lightweight, no full page reload)
            this.refreshTimer = setInterval(() => this._refreshChartsOnly(), CONSTANTS.POLLING.METRICS);

        } catch (e) {
            document.getElementById('deviceDetailContent').innerHTML =
                `<p class="error-text">Failed to load device: ${e.message}</p>`;
        }
    },

    async _loadAndDraw(canvasId, metricType, label, color) {
        try {
            const metrics = await API.getDeviceMetrics(this.deviceId, {
                metric_type: metricType,
                limit: '50',
            });

            const canvas = document.getElementById(canvasId);
            if (!canvas) return;

            const data = metrics
                .filter(m => m.metric_name?.includes('usage') || m.metric_name?.includes('pct'))
                .reverse()
                .map(m => ({
                    x: new Date(m.collected_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
                    y: m.value,
                }));

            if (this.chartInstances[canvasId]) {
                this.chartInstances[canvasId].destroy();
            }

            if (data.length === 0) {
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#aaa';
                ctx.font = '14px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('No data collected yet', canvas.width / 2, canvas.height / 2);
                return;
            }

            this.chartInstances[canvasId] = new Chart(canvas, {
                type: 'line',
                data: {
                    datasets: [{
                        label,
                        data,
                        borderColor: color,
                        backgroundColor: color + '30',
                        fill: true,
                        tension: 0.3,
                        pointRadius: data.length < 20 ? 3 : 0,
                        borderWidth: 2,
                    }],
                },
                options: {
                    ...CONSTANTS.CHART_DEFAULTS,
                    scales: {
                        ...CONSTANTS.CHART_DEFAULTS.scales,
                        y: {
                            beginAtZero: true,
                            ...(metricType !== 'network' ? { max: 100 } : {}),
                            ticks: { callback: v => metricType === 'network' ? Format.bps(v) : Format.percent(v) },
                        },
                    },
                },
            });
        } catch (e) {
            console.error(`Failed to load ${metricType} metrics:`, e);
        }
    },

    _onMetricUpdate(payload) {
        if (payload.device_id !== this.deviceId) return;
        this._refreshChartsOnly();
    },

    _pingSpanIdx: 10,  // default: 30m
    _pingSpans: [
        {min:525600,label:'1y',group:'day'},    // 0
        {min:262800,label:'6mo',group:'day'},   // 1
        {min:131400,label:'3mo',group:'day'},   // 2
        {min:43800,label:'1mo',group:'day'},    // 3
        {min:10080,label:'1w',group:'hour'},    // 4
        {min:4320,label:'3d',group:'hour'},     // 5
        {min:1440,label:'1d',group:'hour'},     // 6
        {min:720,label:'12h',group:'min'},      // 7
        {min:360,label:'6h',group:'min'},       // 8
        {min:60,label:'1h',group:'min'},        // 9
        {min:30,label:'30m',group:'min'},       // 10
        {min:10,label:'10m',group:'min'},       // 11
        {min:5,label:'5m',group:'min'},         // 12
    ],

    _zoomIn() {
        if (this._pingSpanIdx < this._pingSpans.length - 1) this._pingSpanIdx++;
        document.getElementById('pingRangeLabel').textContent = this._pingSpans[this._pingSpanIdx].label;
        this._loadPingChart();
    },
    _zoomOut() {
        if (this._pingSpanIdx > 0) this._pingSpanIdx--;
        document.getElementById('pingRangeLabel').textContent = this._pingSpans[this._pingSpanIdx].label;
        this._loadPingChart();
    },

    _formatUTC(v) {
        const d = Format._parseUTC(v);
        if (!d || isNaN(d.getTime())) return '';
        return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' });
    },
    _formatFullUTC(v) {
        const d = Format._parseUTC(v);
        if (!d || isNaN(d.getTime())) return '';
        return d.toLocaleString('zh-CN', { year:'numeric',month:'2-digit',day:'2-digit', hour:'2-digit',minute:'2-digit',second:'2-digit', timeZone:'Asia/Shanghai' });
    },

    async _loadPingChart() {
        try {
            const span = this._pingSpans[this._pingSpanIdx];
            const minutes = span.min;
            const group = span.group;
            const limit = minutes <= 60 ? Math.max(minutes * 4, 10) : Math.max(minutes, 20);
            const latencyMetrics = await API.getDeviceMetrics(this.deviceId, { metric_name: 'icmp_latency_ms', limit: String(limit) });
            const reachMetrics = await API.getDeviceMetrics(this.deviceId, { metric_name: 'icmp_reachable', limit: String(limit) });

            const canvas = document.getElementById('pingDetailChart');
            if (!canvas) return;

            // Group by time bucket based on span
            const raw = latencyMetrics.reverse();
            const buckets = {};
            const getBucket = (ts) => {
                if (group === 'day') return (ts||'').slice(0, 10);       // "2026-07-07"
                if (group === 'hour') return (ts||'').slice(0, 13);     // "2026-07-07T13"
                return (ts||'').slice(0, 16);                            // "2026-07-07T13:41"
            };
            for (const m of raw) {
                const key = getBucket(m.collected_at);
                if (!buckets[key]) buckets[key] = { sum: 0, count: 0, time: m.collected_at };
                buckets[key].sum += m.value || 0; buckets[key].count++;
            }
            const pingData = Object.entries(buckets).map(([key, v]) => ({
                x: group === 'day' ? key.slice(5) : group === 'hour' ? this._formatUTC(key + ':00') : this._formatUTC(key),
                y: Math.round(v.sum / v.count * 10) / 10,
                fullTime: this._formatFullUTC(v.time),
            })).slice(-Math.min(Object.keys(buckets).length, 60));

            document.getElementById('pingRangeLabel').textContent = span.label;

            if (this.chartInstances['pingDetailChart']) this.chartInstances['pingDetailChart'].destroy();

            if (pingData.length > 0) {
                const maxY = Math.max(...pingData.map(p => p.y), 5);
                this.chartInstances['pingDetailChart'] = new Chart(canvas, {
                    type: 'line', data: { datasets: [{ label: 'Ping (ms)', data: pingData,
                        borderColor: '#4361ee', backgroundColor: '#4361ee20', fill: true,
                        tension: 0.3, pointRadius: pingData.length < 15 ? 3 : 0, pointHoverRadius: 5, borderWidth: 2 }] },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        interaction: { mode: 'index', intersect: false },
                        plugins: { legend: { display: false },
                            tooltip: { callbacks: {
                                title: (items) => items[0]?.raw?.fullTime || '',
                                label: (ctx) => 'Ping: ' + ctx.raw.y + ' ms' } } },
                        scales: { x: { ticks: { maxTicksLimit: 6, font: { size: 10 } }, grid: { display: false } },
                            y: { beginAtZero: false, min: 0, max: maxY * 1.3, ticks: { font: { size: 10 }, callback: v => v.toFixed(1) + 'ms' } } },
                    },
                });
            }

            // Status bar with instant tooltip
            const bar = document.getElementById('pingStatusBar');
            if (!bar) return;
            const reachData = reachMetrics.reverse();
            if (reachData.length === 0) { bar.innerHTML = '<span style="width:100%;background:#ddd;display:block;height:100%;"></span>'; return; }
            const barBuckets = {};
            for (const r of reachData) {
                const key = getBucket(r.collected_at);
                if (!barBuckets[key]) barBuckets[key] = { up: true, time: r.collected_at };
                if (r.value < 1) barBuckets[key].up = false;
            }
            const barEntries = Object.entries(barBuckets).slice(-Math.min(Object.keys(barBuckets).length, 60));
            bar.innerHTML = '';
            barEntries.forEach(([min, v]) => {
                const span = document.createElement('span');
                span.style.cssText = 'flex:1;background:'+(v.up?'#2ecc71':'#e74c3c')+';display:block;height:100%;min-width:2px;cursor:pointer;';
                span.onmouseenter = function(e) {
                    const tip = document.getElementById('pingTooltip');
                    if (tip) { tip.textContent = DeviceDetailPage._formatFullUTC(v.time) + '  ' + (v.up?'UP':'DOWN'); tip.style.display='block'; tip.style.left=e.clientX+12+'px'; tip.style.top=e.clientY-28+'px'; }
                };
                span.onmousemove = function(e) { const tip=document.getElementById('pingTooltip'); if(tip){tip.style.left=e.clientX+12+'px';tip.style.top=e.clientY-28+'px';} };
                span.onmouseleave = function() { const tip=document.getElementById('pingTooltip'); if(tip)tip.style.display='none'; };
                bar.appendChild(span);
            });

        } catch(e) { /* silent */ }
    },

    async _refreshChartsOnly() {
        try {
            await Promise.all([
                this._loadAndDraw('cpuDetailChart', 'cpu', 'CPU %', CONSTANTS.METRIC_TYPES.cpu.color),
                this._loadAndDraw('memDetailChart', 'memory', 'Memory %', CONSTANTS.METRIC_TYPES.memory.color),
                this._loadPingChart(),
            ]);
        } catch(e) { /* silent */ }
    },

    async loadInterfaces() {
        const container = document.getElementById('deviceInterfaces');
        if (!container) return;

        try {
            const interfaces = await API.getDeviceInterfaces(this.deviceId);
            if (interfaces.length === 0) {
                container.innerHTML = '<p class="text-muted">No interfaces found</p>';
                return;
            }

            container.innerHTML = `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Status</th><th>Name</th><th>Type</th><th>MAC</th>
                            <th>Speed</th><th>Last Change</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${interfaces.map(iface => `
                            <tr>
                                <td><span class="status-badge ${iface.status === 'up' ? 'online' : 'offline'}">${iface.status}</span></td>
                                <td><strong>${Format.esc(iface.name)}</strong>${iface.alias ? ` <small>(${Format.esc(iface.alias)})</small>` : ''}</td>
                                <td>${Format.esc(iface.if_type || '-')}</td>
                                <td><code>${Format.esc(iface.mac_address || '-')}</code></td>
                                <td>${iface.speed ? Format.bps(iface.speed) : '-'}</td>
                                <td>${Format.ago(iface.last_change)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        } catch (e) {
            container.innerHTML = `<p class="error-text">${e.message}</p>`;
        }
    },

    editDevice() {
        App.navigateTo('devices');
    },

    refresh() {
        this.loadDevice();
    },

};
