/**
 * Alerts Page — alert history and rule configuration.
 */
const AlertsPage = {
    tab: 'alerts', // 'alerts' or 'rules'

    async render() {
        const container = document.getElementById('pageContainer');
        container.innerHTML = `
            <div class="page-header">
                <h2><i class="fas fa-bell"></i> Alerts</h2>
                <div class="header-actions">
                    <button class="btn btn-sm ${this.tab === 'alerts' ? 'btn-primary' : ''}"
                            onclick="AlertsPage.switchTab('alerts')">Alert History</button>
                    <button class="btn btn-sm ${this.tab === 'rules' ? 'btn-primary' : ''}"
                            onclick="AlertsPage.switchTab('rules')">Alert Rules</button>
                </div>
            </div>
            <div id="alertsContent"><div class="spinner"></div></div>
        `;

        await this.loadContent();
    },

    destroy() {},

    async switchTab(tab) {
        this.tab = tab;
        await this.render();
    },

    async loadContent() {
        if (this.tab === 'alerts') {
            await this._loadAlerts();
        } else {
            await this._loadRules();
        }
    },

    async _loadAlerts() {
        const content = document.getElementById('alertsContent');
        try {
            const alerts = await API.getAlerts({ limit: '200' });
            if (alerts.length === 0) {
                content.innerHTML = `<div class="empty-state">
                    <i class="fas fa-bell-slash" style="font-size:48px;color:#ccc;margin-bottom:15px;display:block;"></i>
                    <p>No alerts yet.</p>
                </div>`;
                return;
            }

            content.innerHTML = `
                <div class="card">
                    <table class="data-table">
                        <thead>
                            <tr><th>Severity</th><th>Device</th><th>Message</th><th>Triggered</th>
                                <th>Resolved</th><th>Actions</th></tr>
                        </thead>
                        <tbody>
                            ${alerts.map(a => `
                                <tr class="alert-row alert-${a.severity}">
                                    <td><span class="severity-badge severity-${a.severity}">${a.severity.toUpperCase()}</span></td>
                                    <td><a href="#/devices/${a.device_id}">Device</a></td>
                                    <td>${Format.esc(a.message)}</td>
                                    <td>${Format.datetime(a.triggered_at)}</td>
                                    <td>${a.resolved_at ? Format.datetime(a.resolved_at) : '<span class="status-badge warning">Active</span>'}</td>
                                    <td>
                                        ${!a.acknowledged ? `
                                            <button class="btn btn-sm btn-success"
                                                    onclick="AlertsPage.acknowledge('${a.id}')">
                                                <i class="fas fa-check"></i> Ack
                                            </button>
                                        ` : '<span class="text-muted">Acknowledged</span>'}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        } catch (e) {
            content.innerHTML = `<p class="error-text">${e.message}</p>`;
        }
    },

    async _loadRules() {
        const content = document.getElementById('alertsContent');
        try {
            const rules = await API.getAlertRules();
            content.innerHTML = `
                <div class="card">
                    <div class="card-header">
                        <h3>Alert Rules</h3>
                        <button class="btn btn-primary btn-sm" onclick="AlertsPage.showAddRuleModal()">
                            <i class="fas fa-plus"></i> Add Rule
                        </button>
                    </div>
                    <div id="rulesTable">
                        ${rules.length === 0 ? `
                            <div class="empty-state">
                                <p>No alert rules configured.</p>
                            </div>
                        ` : `
                            <table class="data-table">
                                <thead>
                                    <tr><th>Name</th><th>Metric</th><th>Condition</th>
                                        <th>Severity</th><th>Status</th><th>Actions</th></tr>
                                </thead>
                                <tbody>
                                    ${rules.map(r => `
                                        <tr>
                                            <td>${Format.esc(r.name)}</td>
                                            <td>${Format.esc(r.metric_type)} / ${Format.esc(r.metric_name)}</td>
                                            <td><code>${r.condition} ${r.threshold}</code></td>
                                            <td><span class="severity-badge severity-${r.severity}">${r.severity}</span></td>
                                            <td>${r.enabled ? '<span class="status-badge online">Enabled</span>' : '<span class="status-badge offline">Disabled</span>'}</td>
                                            <td>
                                                <button class="btn btn-sm btn-danger"
                                                        onclick="AlertsPage.deleteRule('${r.id}')">
                                                    <i class="fas fa-trash"></i>
                                                </button>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        `}
                    </div>
                </div>
            `;
        } catch (e) {
            content.innerHTML = `<p class="error-text">${e.message}</p>`;
        }
    },

    showAddRuleModal() {
        App.showModal('Add Alert Rule', `
            <div class="form-group">
                <label>Rule Name</label>
                <input type="text" id="ruleName" class="form-input" placeholder="e.g. High CPU on Core Router">
            </div>
            <div class="form-group">
                <label>Metric Type</label>
                <select id="ruleMetricType" class="form-input">
                    <option value="cpu">CPU</option>
                    <option value="memory">Memory</option>
                    <option value="disk">Disk</option>
                    <option value="network">Network</option>
                </select>
            </div>
            <div class="form-group">
                <label>Metric Name</label>
                <input type="text" id="ruleMetricName" class="form-input" placeholder="cpu_usage_pct">
            </div>
            <div class="form-group">
                <label>Condition</label>
                <select id="ruleCondition" class="form-input">
                    <option value=">">&gt; (greater than)</option>
                    <option value="<">&lt; (less than)</option>
                    <option value=">=">&gt;= (greater or equal)</option>
                    <option value="<=">&lt;= (less or equal)</option>
                    <option value="==">== (equal)</option>
                </select>
            </div>
            <div class="form-group">
                <label>Threshold</label>
                <input type="number" id="ruleThreshold" class="form-input" value="90" step="0.1">
            </div>
            <div class="form-group">
                <label>Severity</label>
                <select id="ruleSeverity" class="form-input">
                    <option value="info">Info</option>
                    <option value="warning">Warning</option>
                    <option value="critical">Critical</option>
                </select>
            </div>
        `, async (box) => {
            const data = {
                name: box.querySelector('#ruleName').value,
                metric_type: box.querySelector('#ruleMetricType').value,
                metric_name: box.querySelector('#ruleMetricName').value,
                condition: box.querySelector('#ruleCondition').value,
                threshold: parseFloat(box.querySelector('#ruleThreshold').value),
                severity: box.querySelector('#ruleSeverity').value,
            };
            if (!data.name) throw new Error('Rule name is required');
            await API.createAlertRule(data);
            App.toast('Alert rule created', 'success');
            await this._loadRules();
        });
    },

    async deleteRule(ruleId) {
        if (!UI.confirmDelete('Delete this alert rule?')) return;
        try {
            await API.deleteAlertRule(ruleId);
            App.toast('Alert rule deleted', 'info');
            await this._loadRules();
        } catch (e) {
            App.toast('Failed to delete rule: ' + e.message, 'danger');
        }
    },

    async acknowledge(alertId) {
        try {
            await API.acknowledgeAlert(alertId);
            App.toast('Alert acknowledged', 'success');
            await this._loadAlerts();
        } catch (e) {
            App.toast('Failed to acknowledge: ' + e.message, 'danger');
        }
    },

};
