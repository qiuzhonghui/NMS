/**
 * Dashboard Page — customizable widget grid for device metrics.
 */
const DashboardPage = {
    widgets: [],
    chartInstances: {},
    refreshTimer: null,

    /** Available metric names per metric type. */
    METRIC_OPTIONS: {
        cpu:    ['cpu_usage_pct', 'cpu_user_pct', 'cpu_system_pct', 'cpu_iowait_pct'],
        memory: ['mem_usage_pct', 'mem_total', 'mem_used', 'mem_available'],
        network:['net_bytes_sent', 'net_bytes_recv', 'net_packets_sent', 'net_packets_recv',
                 'net_errors_in', 'net_errors_out', 'net_drops_in', 'net_drops_out'],
        icmp:   ['icmp_latency_ms', 'icmp_packet_loss_pct', 'icmp_jitter_ms'],
    },

    /** Default max values for gauge rendering (percentage defaults to 100). */
    METRIC_MAX: {
        cpu_usage_pct: 100, cpu_user_pct: 100, cpu_system_pct: 100, cpu_iowait_pct: 100,
        mem_usage_pct: 100,
        icmp_packet_loss_pct: 100,
        icmp_latency_ms: 500, icmp_jitter_ms: 100,
    },

    /** Unit labels per metric name. */
    METRIC_UNITS: {
        cpu_usage_pct: '%', cpu_user_pct: '%', cpu_system_pct: '%', cpu_iowait_pct: '%',
        mem_usage_pct: '%', mem_total: 'B', mem_used: 'B', mem_available: 'B',
        net_bytes_sent: 'B', net_bytes_recv: 'B',
        net_packets_sent: '', net_packets_recv: '',
        net_errors_in: '', net_errors_out: '',
        net_drops_in: '', net_drops_out: '',
        icmp_latency_ms: 'ms', icmp_packet_loss_pct: '%', icmp_jitter_ms: 'ms',
    },

    // ─── Lifecycle ─────────────────────────────────────────────

    async render() {
        const container = document.getElementById('pageContainer');
        container.innerHTML = `
            <div class="page-header">
                <h2><i class="fas fa-tachometer-alt"></i> ${T('dashboard')}</h2>
                <span id="dashboardTime" class="text-muted"></span>
            </div>
            <div class="quick-stats" id="quickStats"></div>
            <div class="widget-toolbar">
                <button class="btn btn-primary" id="btnAddWidget">
                    <i class="fas fa-plus"></i> ${T('add_widget')}
                </button>
            </div>
            <div class="widget-grid" id="widgetGrid"></div>
        `;

        document.getElementById('btnAddWidget').addEventListener('click', () => this._showAddWidgetModal());

        this._loadWidgets();
        await this.loadDashboard();
        this._startAutoRefresh();
    },

    destroy() {
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        this._destroyAllCharts();
    },

    _destroyAllCharts() {
        Object.values(this.chartInstances).forEach(c => {
            try { c.destroy(); } catch (e) { /* ignore */ }
        });
        this.chartInstances = {};
    },

    _startAutoRefresh() {
        this.refreshTimer = setInterval(() => this.loadDashboard(), CONSTANTS.POLLING.METRICS);
    },

    // ─── Widget Persistence ────────────────────────────────────

    _loadWidgets() {
        try {
            const raw = localStorage.getItem('nms_dashboard_widgets');
            this.widgets = raw ? JSON.parse(raw) : [];
        } catch (e) {
            this.widgets = [];
        }
    },

    _saveWidgets() {
        localStorage.setItem('nms_dashboard_widgets', JSON.stringify(this.widgets));
    },

    _generateId() {
        return 'w_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    },

    // ─── Default Widgets ───────────────────────────────────────

    async _initDefaultWidgets() {
        let devices;
        try {
            devices = await API.getDevices();
        } catch (e) {
            return;
        }
        const online = devices.filter(d => d.status === 'online');
        if (online.length === 0) return;

        const defaults = [];
        for (const d of online) {
            defaults.push({
                id: this._generateId(),
                deviceId: d.id,
                deviceName: d.name || d.hostname || d.ip_address,
                metricType: 'cpu',
                metricName: 'cpu_usage_pct',
                chartType: 'gauge',
                title: (d.name || d.hostname || d.ip_address) + ' - CPU',
                size: 'small',
            });
            defaults.push({
                id: this._generateId(),
                deviceId: d.id,
                deviceName: d.name || d.hostname || d.ip_address,
                metricType: 'memory',
                metricName: 'mem_usage_pct',
                chartType: 'gauge',
                title: (d.name || d.hostname || d.ip_address) + ' - ' + T('memory'),
                size: 'small',
            });
        }
        this.widgets = defaults;
        this._saveWidgets();
    },

    // ─── Main Load ─────────────────────────────────────────────

    async loadDashboard() {
        try {
            const devices = await API.getDevices();

            // Timestamp
            const timeEl = document.getElementById('dashboardTime');
            if (timeEl) {
                timeEl.textContent = T('last_updated') + ': ' + new Date().toLocaleTimeString('zh-CN');
            }

            // Quick stats
            const online = devices.filter(d => d.status === 'online').length;
            const offline = devices.filter(d => d.status === 'offline').length;
            const warning = devices.filter(d => d.status === 'warning').length;
            document.getElementById('quickStats').innerHTML = `
                <div class="stat-tile">
                    <span class="stat-value">${devices.length}</span>
                    <span class="stat-label">${T('total_devices')}</span>
                </div>
                <div class="stat-tile stat-online">
                    <span class="stat-value">${online}</span>
                    <span class="stat-label">${T('online_count')}</span>
                </div>
                <div class="stat-tile stat-warning">
                    <span class="stat-value">${warning}</span>
                    <span class="stat-label">${T('warning_count')}</span>
                </div>
                <div class="stat-tile stat-offline">
                    <span class="stat-value">${offline}</span>
                    <span class="stat-label">${T('offline_count')}</span>
                </div>
            `;

            // Ensure defaults exist
            if (this.widgets.length === 0) {
                await this._initDefaultWidgets();
            }

            // Build device lookup for display names
            const deviceMap = {};
            for (const d of devices) {
                deviceMap[d.id] = d;
            }

            await this._renderWidgetGrid(deviceMap);

        } catch (e) {
            console.error('Dashboard load error:', e);
        }
    },

    // ─── Widget Grid Rendering ─────────────────────────────────

    async _renderWidgetGrid(deviceMap) {
        const grid = document.getElementById('widgetGrid');
        if (!grid) return;

        // Clean up stale chart instances for removed widgets
        const activeIds = new Set(this.widgets.map(w => w.id));
        for (const key of Object.keys(this.chartInstances)) {
            if (!activeIds.has(key)) {
                try { this.chartInstances[key].destroy(); } catch (e) { /* ignore */ }
                delete this.chartInstances[key];
            }
        }

        if (this.widgets.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column:1/-1;">
                    <i class="fas fa-th-large" style="font-size:48px;color:#ccc;margin-bottom:15px;display:block;"></i>
                    <p>${T('no_widgets')}</p>
                </div>`;
            return;
        }

        // Build grid HTML
        grid.innerHTML = this.widgets.map(w => {
            const sizeClass = 'widget-size-' + (w.size || 'small');
            return `
                <div class="widget-card ${sizeClass}" id="widget-${w.id}">
                    <div class="widget-header">
                        <span class="widget-title" title="${Format.esc(w.title)}">${Format.esc(w.title)}</span>
                        <button class="widget-close" data-widget-id="${w.id}" title="${T('remove_widget')}">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="widget-body" id="widgetBody-${w.id}">
                        <div class="widget-loading">${T('loading')}...</div>
                    </div>
                </div>`;
        }).join('');

        // Bind close buttons
        grid.querySelectorAll('.widget-close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const widgetId = btn.getAttribute('data-widget-id');
                this._removeWidget(widgetId);
            });
        });

        // Load data and draw each widget
        await this._refreshAllWidgets(deviceMap);
    },

    async _refreshAllWidgets(deviceMap) {
        // Collect unique device IDs for batch latest-metrics fetch
        const gaugeBigNumWidgets = this.widgets.filter(w => w.chartType !== 'line');
        const deviceIdSet = new Set(gaugeBigNumWidgets.map(w => w.deviceId));
        const deviceIds = Array.from(deviceIdSet);

        // Fetch latest metrics in one batch for gauge / big-number widgets
        let latestMap = {};
        if (deviceIds.length > 0) {
            try {
                latestMap = await API.getLatestMetrics(deviceIds);
            } catch (e) {
                // proceed with empty map
            }
        }

        // Draw each widget
        for (const widget of this.widgets) {
            const body = document.getElementById('widgetBody-' + widget.id);
            if (!body) continue;

            // Update title from deviceMap if device was renamed
            if (deviceMap && deviceMap[widget.deviceId]) {
                const d = deviceMap[widget.deviceId];
                const displayName = d.name || d.hostname || d.ip_address;
                if (widget.deviceName !== displayName) {
                    widget.deviceName = displayName;
                }
                const titleEl = document.querySelector('#widget-' + widget.id + ' .widget-title');
                if (titleEl) {
                    titleEl.textContent = widget.title;
                    titleEl.title = widget.title;
                }
            }

            try {
                if (widget.chartType === 'line') {
                    const metrics = await API.getDeviceMetrics(widget.deviceId, {
                        metric_type: widget.metricType,
                        metric_name: widget.metricName,
                        limit: '20',
                    });
                    this._drawLineChart(widget, metrics);
                } else {
                    // Gauge or big-number: use latest metrics
                    let value = null;
                    const devMetrics = latestMap[widget.deviceId];
                    if (devMetrics && devMetrics[widget.metricName]) {
                        value = devMetrics[widget.metricName].value;
                    }
                    if (widget.chartType === 'gauge') {
                        this._drawGauge(widget, value);
                    } else {
                        this._drawBigNumber(widget, value);
                    }
                }
            } catch (e) {
                body.innerHTML = `<div class="widget-error">${T('no_data')}</div>`;
            }
        }
    },

    // ─── Chart Drawing ─────────────────────────────────────────

    _drawLineChart(widget, metrics) {
        const body = document.getElementById('widgetBody-' + widget.id);
        if (!body) return;

        // Ensure canvas exists
        if (!body.querySelector('canvas')) {
            body.innerHTML = '<canvas id="lineCanvas-' + widget.id + '" style="width:100%;height:200px;"></canvas>';
        }

        const canvasId = 'lineCanvas-' + widget.id;
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        // Destroy previous chart
        if (this.chartInstances[widget.id]) {
            try { this.chartInstances[widget.id].destroy(); } catch (e) { /* ignore */ }
        }

        const data = (metrics || [])
            .filter(m => m.collected_at != null && m.value != null)
            .sort((a, b) => new Date(a.collected_at) - new Date(b.collected_at))
            .map(m => ({
                x: new Date(m.collected_at).toLocaleTimeString('zh-CN', {
                    hour: '2-digit', minute: '2-digit',
                }),
                y: m.value,
            }));

        if (data.length === 0) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#aaa';
            ctx.font = '13px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(T('no_data'), canvas.width / 2, canvas.height / 2);
            return;
        }

        const color = (CONSTANTS.METRIC_TYPES[widget.metricType] &&
                       CONSTANTS.METRIC_TYPES[widget.metricType].color) || '#4361ee';
        const unit = this.METRIC_UNITS[widget.metricName] || '';
        const label = Format.esc(widget.metricName) + (unit ? ' (' + unit + ')' : '');

        this.chartInstances[widget.id] = new Chart(canvas, {
            type: 'line',
            data: {
                datasets: [{
                    label: label,
                    data: data,
                    borderColor: color,
                    backgroundColor: color + '20',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 2,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 300 },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { boxWidth: 8, font: { size: 10 }, padding: 8 },
                    },
                },
                scales: {
                    x: {
                        display: true,
                        grid: { display: false },
                        ticks: { maxTicksLimit: 6, font: { size: 9 } },
                    },
                    y: {
                        display: true,
                        beginAtZero: true,
                        grid: { color: '#f0f0f0' },
                        ticks: {
                            font: { size: 9 },
                            callback: function(v) { return v + (unit || ''); },
                        },
                    },
                },
            },
        });
    },

    _drawGauge(widget, value) {
        const body = document.getElementById('widgetBody-' + widget.id);
        if (!body) return;

        if (!body.querySelector('canvas')) {
            body.innerHTML = '<canvas id="gaugeCanvas-' + widget.id + '" style="width:100%;height:180px;"></canvas>';
        }

        const canvasId = 'gaugeCanvas-' + widget.id;
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        // Clean up if there was a Chart.js instance for this widget
        if (this.chartInstances[widget.id]) {
            try { this.chartInstances[widget.id].destroy(); } catch (e) { /* ignore */ }
            delete this.chartInstances[widget.id];
        }

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const w = rect.width * dpr;
        const h = rect.height * dpr;
        canvas.width = w;
        canvas.height = h;
        ctx.scale(dpr, dpr);

        const cw = rect.width;
        const ch = rect.height;
        const centerX = cw / 2;
        const centerY = ch * 0.72;
        const radius = Math.min(cw, ch * 1.4) * 0.42;

        ctx.clearRect(0, 0, cw, ch);

        if (value == null || isNaN(value)) {
            ctx.fillStyle = '#aaa';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(T('no_data'), centerX, centerY);
            return;
        }

        const maxVal = this.METRIC_MAX[widget.metricName] ||
            (widget.metricName && widget.metricName.includes('_pct') ? 100 : 100);
        const fraction = Math.min(Math.max(value / maxVal, 0), 1);

        // Determine color zones
        const colorOk = '#2ecc71';
        const colorWarn = '#f39c12';
        const colorCrit = '#e74c3c';

        // Background arc
        const startAngle = Math.PI;
        const endAngle = 2 * Math.PI;
        const arcRange = endAngle - startAngle;

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, startAngle, endAngle);
        ctx.lineWidth = 16;
        ctx.strokeStyle = '#e9ecef';
        ctx.stroke();

        // Value arc (color-coded by zone)
        const fillAngle = startAngle + arcRange * fraction;
        let fillColor = colorOk;
        if (fraction > 0.9) fillColor = colorCrit;
        else if (fraction > 0.7) fillColor = colorWarn;

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, startAngle, fillAngle);
        ctx.lineWidth = 16;
        ctx.strokeStyle = fillColor;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Needle
        const needleAngle = fillAngle;
        const needleLength = radius - 18;
        const nx = centerX + Math.cos(needleAngle) * needleLength;
        const ny = centerY + Math.sin(needleAngle) * needleLength;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(nx, ny);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#333';
        ctx.stroke();

        // Center dot
        ctx.beginPath();
        ctx.arc(centerX, centerY, 6, 0, 2 * Math.PI);
        ctx.fillStyle = '#333';
        ctx.fill();

        // Value text
        const unit = this.METRIC_UNITS[widget.metricName] || '';
        ctx.fillStyle = '#2c3e50';
        ctx.font = 'bold 28px ' + getComputedStyle(document.body).fontFamily;
        ctx.textAlign = 'center';
        const dispVal = typeof value === 'number' ? (value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)) : value;
        ctx.fillText(dispVal + unit, centerX, centerY + 30);

        // Label
        ctx.fillStyle = '#7f8c8d';
        ctx.font = '12px ' + getComputedStyle(document.body).fontFamily;
        ctx.fillText(Format.esc(widget.metricName), centerX, centerY + 50);
    },

    _drawBigNumber(widget, value) {
        const body = document.getElementById('widgetBody-' + widget.id);
        if (!body) return;

        // Clean up chart instance if any
        if (this.chartInstances[widget.id]) {
            try { this.chartInstances[widget.id].destroy(); } catch (e) { /* ignore */ }
            delete this.chartInstances[widget.id];
        }

        const unit = this.METRIC_UNITS[widget.metricName] || '';
        let displayValue;
        if (value == null || isNaN(value)) {
            displayValue = '<span class="bn-placeholder">' + T('no_data') + '</span>';
        } else {
            const formatted = typeof value === 'number'
                ? (value % 1 === 0 ? value.toFixed(0) : value.toFixed(1))
                : value;
            displayValue = '<span class="bn-value">' + formatted + '</span>' +
                           '<span class="bn-unit">' + unit + '</span>';
        }

        body.innerHTML = `
            <div class="big-number-display">
                ${displayValue}
                <div class="bn-label">${Format.esc(widget.metricName)}</div>
            </div>`;
    },

    // ─── Add Widget Modal ──────────────────────────────────────

    async _showAddWidgetModal() {
        let devices;
        try {
            devices = await API.getDevices();
        } catch (e) {
            App.toast(T('load_failed'), 'danger');
            return;
        }

        if (devices.length === 0) {
            App.toast(T('no_managed'), 'warning');
            return;
        }

        const deviceOpts = devices.map(d =>
            `<option value="${d.id}">${Format.esc(d.name || d.hostname || d.ip_address)} (${Format.esc(d.ip_address)})</option>`
        ).join('');

        const metricTypeOpts = Object.keys(this.METRIC_OPTIONS).map(mt =>
            `<option value="${mt}">${mt.charAt(0).toUpperCase() + mt.slice(1)}</option>`
        ).join('');

        const firstMT = Object.keys(this.METRIC_OPTIONS)[0];
        const metricNameOpts = this.METRIC_OPTIONS[firstMT].map(mn =>
            `<option value="${mn}">${mn}</option>`
        ).join('');

        const defaultDevice = devices[0];
        const defaultTitle = Format.esc(
            (defaultDevice.name || defaultDevice.hostname || defaultDevice.ip_address) +
            ' - ' + this.METRIC_OPTIONS[firstMT][0]
        );

        const content = `
            <div class="form-group">
                <label>${T('select_device')}</label>
                <select id="awDevice" class="form-control">${deviceOpts}</select>
            </div>
            <div class="form-group">
                <label>${T('select_metric')}</label>
                <select id="awMetricType" class="form-control">${metricTypeOpts}</select>
            </div>
            <div class="form-group">
                <label>${T('metric_name') || 'Metric Name'}</label>
                <select id="awMetricName" class="form-control">${metricNameOpts}</select>
            </div>
            <div class="form-group">
                <label>${T('chart_type')}</label>
                <select id="awChartType" class="form-control">
                    <option value="line">${T('line_chart')}</option>
                    <option value="gauge">${T('gauge_chart')}</option>
                    <option value="big-number">${T('big_number')}</option>
                </select>
            </div>
            <div class="form-group">
                <label>${T('widget_title')}</label>
                <input type="text" id="awTitle" class="form-control" value="${defaultTitle}">
            </div>
            <div class="form-group">
                <label>${T('widget_size')}</label>
                <select id="awSize" class="form-control">
                    <option value="small">${T('small')}</option>
                    <option value="medium">${T('medium')}</option>
                    <option value="large">${T('large')}</option>
                </select>
            </div>
        `;

        // We'll track state outside the modal callback
        const self = this;

        App.showModal(T('add_widget'), content, async function(box) {
            const deviceId = parseInt(box.querySelector('#awDevice').value, 10);
            const metricType = box.querySelector('#awMetricType').value;
            const metricName = box.querySelector('#awMetricName').value;
            const chartType = box.querySelector('#awChartType').value;
            const title = box.querySelector('#awTitle').value.trim();
            const size = box.querySelector('#awSize').value;

            if (!title) throw new Error('Title is required');

            const dev = devices.find(d => d.id === deviceId);
            const deviceName = dev ? (dev.name || dev.hostname || dev.ip_address) : 'Unknown';

            const widget = {
                id: self._generateId(),
                deviceId: deviceId,
                deviceName: deviceName,
                metricType: metricType,
                metricName: metricName,
                chartType: chartType,
                title: title,
                size: size,
            };

            self.widgets.push(widget);
            self._saveWidgets();
            await self.loadDashboard();
            if (typeof I18N !== 'undefined') I18N.apply();
        });

        // After the modal is shown, react to the DOM (next tick)
        // We need to hook up the metric-type -> metric-name cascade.
        // App.showModal is synchronous for innerHTML, but we need to wait for it.
        await this._hookModalCascade(devices);
    },

    async _hookModalCascade(devices) {
        // The modal is inserted into #modalBox synchronously, but we need a tick
        // for the DOM to be fully painted. Use a short timeout.
        await new Promise(resolve => setTimeout(resolve, 50));

        const box = document.getElementById('modalBox');
        if (!box) return;

        const awDevice = box.querySelector('#awDevice');
        const awMetricType = box.querySelector('#awMetricType');
        const awMetricName = box.querySelector('#awMetricName');
        const awTitle = box.querySelector('#awTitle');

        if (!awMetricType || !awMetricName) return;

        const self = this;

        function updateMetricNames() {
            const mt = awMetricType.value;
            const names = self.METRIC_OPTIONS[mt] || [];
            awMetricName.innerHTML = names.map(n =>
                `<option value="${n}">${n}</option>`
            ).join('');
        }

        function updateTitle() {
            const devId = parseInt(awDevice.value, 10);
            const dev = devices.find(d => d.id === devId);
            const devName = dev ? (dev.name || dev.hostname || dev.ip_address) : '';
            const mn = awMetricName.value || '';
            awTitle.value = devName + (mn ? ' - ' + mn : '');
        }

        awMetricType.addEventListener('change', () => {
            updateMetricNames();
            updateTitle();
        });

        awDevice.addEventListener('change', updateTitle);
        awMetricName.addEventListener('change', updateTitle);
    },

    // ─── Remove Widget ─────────────────────────────────────────

    _removeWidget(widgetId) {
        // Destroy any chart for this widget
        if (this.chartInstances[widgetId]) {
            try { this.chartInstances[widgetId].destroy(); } catch (e) { /* ignore */ }
            delete this.chartInstances[widgetId];
        }

        this.widgets = this.widgets.filter(w => w.id !== widgetId);
        this._saveWidgets();
        this.loadDashboard();
    },

    // ─── Helpers ───────────────────────────────────────────────

};
