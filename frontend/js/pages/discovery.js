/**
 * Network Discovery Page — scan networks, view and approve discovered devices.
 */
const DiscoveryPage = {
    scanInProgress: false,
    scanTimer: null,
    scanId: null,
    sortCol: null,
    sortAsc: true,
    discoveredCache: [],

    // Bound WebSocket handlers — stored so destroy() can unregister them
    _onDeviceFound: null,
    _onScanStopped: null,

    async render() {
        const container = document.getElementById('pageContainer');
        container.innerHTML = `
            <div class="page-header">
                <h2><i class="fas fa-search"></i> ${T('device_discovery')}</h2>
                <p>${T('scan_desc')}</p>
            </div>

            <div class="card scan-form">
                <h3>${T('network_scan')}</h3>
                <div class="form-row">
                    <div class="form-group flex-grow">
                        <label>${T('network_ranges')}</label>
                        <input type="text" id="scanRanges" class="form-input"
                               placeholder="${T('ranges_placeholder')}">
                        <small>${T('ranges_hint')}</small>
                    </div>
                    <div class="form-group" style="width:160px;">
                        <label>${T('snmp_community')}</label>
                        <input type="text" id="scanCommunities" class="form-input"
                               placeholder="public,private" value="public">
                        <small>${T('communities_hint')}</small>
                    </div>
                    <div class="form-group" style="align-self:flex-end;display:flex;gap:6px;">
                        <button class="btn btn-primary" id="startScanBtn" onclick="DiscoveryPage.startScan()">
                            <i class="fas fa-play"></i> ${T('start_scan')}
                        </button>
                        <button class="btn btn-danger" id="stopScanBtn" onclick="DiscoveryPage.stopScan()" style="display:none;">
                            <i class="fas fa-stop"></i> <span data-i18n="stop">${T('stop')}</span>
                        </button>
                    </div>
                </div>
                <div class="scan-progress" id="scanProgress" style="display:none;margin-top:16px;padding-top:14px;border-top:1px solid #e1e5eb;">
                    <div class="progress-stats" id="scanProgressStats">
                        <span>${T('scanned')}: <strong id="scanCount">0</strong> / <strong id="scanTotal">0</strong></span>
                        <span>${T('found')}: <strong id="scanFound" style="color:#27ae60;">0</strong></span>
                    </div>
                    <div class="progress-bar progress-bar-green">
                        <div class="progress-fill-green" id="scanProgressFill"></div>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:11px;color:#888;margin-top:3px;">
                        <span class="progress-text" id="scanProgressText">${T('initializing')}</span>
                        <span id="scanToolText" style="font-family:monospace;"></span>
                    </div>
                </div>
            </div>

            <div class="card" style="margin-top:20px;">
                <div class="card-header">
                    <h3>${T('discovered_devices')} <span id="discoveredCount" style="font-weight:400;color:#999;font-size:14px;"></span></h3>
                    <div style="display:flex;gap:6px;">
                        <button class="btn btn-sm btn-danger" onclick="DiscoveryPage.clearAll()">
                            <i class="fas fa-trash"></i> <span data-i18n="clear">${T('clear')}</span>
                        </button>
                        <button class="btn btn-sm" onclick="DiscoveryPage.loadDiscovered()">
                            <i class="fas fa-sync-alt"></i> ${T('refresh')}
                        </button>
                    </div>
                </div>
                <div id="discoveredTable">
                    <div class="spinner"></div>
                </div>
            </div>
        `;

        // Load existing discovered devices into cache and render
        await this.loadDiscovered();
    },

    /**
     * Called by the router when navigating away.
     * Clean up all intervals and WebSocket listeners.
     */
    destroy() {
        this._cleanupScan();
    },

    /**
     * Stop polling, remove WebSocket listeners, reset UI state.
     */
    _cleanupScan() {
        if (this.scanTimer) {
            clearInterval(this.scanTimer);
            this.scanTimer = null;
        }
        if (this._onDeviceFound) {
            NMS_WS.off('scan_device_found', this._onDeviceFound);
            this._onDeviceFound = null;
        }
        if (this._onScanStopped) {
            NMS_WS.off('scan_stopped', this._onScanStopped);
            this._onScanStopped = null;
        }
        this.scanInProgress = false;
        this.scanId = null;

        // Reset button visibility
        const startBtn = document.getElementById('startScanBtn');
        const stopBtn = document.getElementById('stopScanBtn');
        const progress = document.getElementById('scanProgress');
        if (startBtn) { startBtn.style.display = ''; startBtn.disabled = false; }
        if (stopBtn) stopBtn.style.display = 'none';
        if (progress) progress.style.display = 'none';
    },

    /**
     * Start a network scan and begin listening for real-time results.
     */
    async startScan() {
        if (this.scanInProgress) return;
        const rangesInput = document.getElementById('scanRanges').value.trim();
        const communitiesInput = document.getElementById('scanCommunities').value.trim();

        if (!rangesInput) {
            App.toast(T('ranges_placeholder'), 'warning');
            return;
        }

        const ranges = rangesInput.split(',').map(r => r.trim()).filter(Boolean);
        const communities = communitiesInput.split(',').map(c => c.trim()).filter(Boolean);
        const concurrency = parseInt(localStorage.getItem('scan_concurrency')) || 50;

        try {
            const result = await API.scanNetwork(ranges, communities, concurrency);
            this.scanInProgress = true;
            this.scanId = result.scan_id;
            this._scanStartTime = Date.now();

            // Toggle buttons: show Stop, hide Start
            document.getElementById('startScanBtn').style.display = 'none';
            document.getElementById('stopScanBtn').style.display = '';
            document.getElementById('scanProgress').style.display = 'block';

            App.toast(T('scan_started') + ` (${result.scan_id})`, 'info');

            // Bind and register WebSocket listeners for real-time device events
            this._onDeviceFound = this._handleDeviceFound.bind(this);
            this._onScanStopped = this._handleScanStopped.bind(this);
            NMS_WS.on('scan_device_found', this._onDeviceFound);
            NMS_WS.on('scan_stopped', this._onScanStopped);
            NMS_WS.on('scan_tool', (d) => {
                const el = document.getElementById('scanToolText');
                if (el) el.textContent = d.ip + ' [' + d.tool + ']';
            });

            // Begin polling for progress bar updates
            this._pollScanProgress(result.scan_id);
        } catch (e) {
            App.toast(T('scan_failed') + ': ' + e.message, 'danger');
        }
    },

    /**
     * WebSocket handler: a new device was found by the running scan.
     * Adds it to the cache and re-renders the table immediately.
     */
    _handleDeviceFound(payload) {
        // payload = { scan_id, device: {...} } from WebSocket
        const d = payload.device || payload;
        if (!d || !d.id) return;
        const exists = this.discoveredCache.some(x => x.id === d.id);
        if (!exists) {
            this.discoveredCache.push(d);
        } else {
            // Update existing device with new data
            const idx = this.discoveredCache.findIndex(x => x.id === d.id);
            if (idx >= 0) Object.assign(this.discoveredCache[idx], d);
        }
        this._renderDiscoveredTable(this.discoveredCache);
    },

    /**
     * WebSocket handler: the running scan was stopped (by user or server).
     */
    _handleScanStopped(data) {
        this._finishScan();
    },

    /**
     * Stop the currently running scan via API, then clean up.
     */
    async stopScan() {
        if (!this.scanId) return;
        try {
            await API.post('/discovery/scan/' + this.scanId + '/stop', {});
        } catch (e) {
            // Proceed with cleanup even if the API call fails
        }
        this._finishScan();
    },

    /**
     * Called when the scan completes or is stopped.
     * Cleans up timers, WS listeners, resets UI, and shows a toast.
     */
    _finishScan() {
        const deviceCount = this.discoveredCache.length;
        // Stop polling and reset buttons, but keep WS listener for bg updates
        if (this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = null; }
        this.scanInProgress = false; this.scanId = null;
        const startBtn = document.getElementById('startScanBtn');
        const stopBtn = document.getElementById('stopScanBtn');
        const progress = document.getElementById('scanProgress');
        if (startBtn) { startBtn.style.display = ''; startBtn.disabled = false; }
        if (stopBtn) stopBtn.style.display = 'none';
        App.toast(T('scan_complete') + ': ' + deviceCount + ' ' + T('devices_found'), 'success');
        // After 30s, clear any stuck loading states
        setTimeout(() => {
            this.discoveredCache.forEach(d => { if (d._loading) d._loading = false; });
            this._renderDiscoveredTable(this.discoveredCache);
        }, 30000);
    },

    /**
     * Poll scan progress from the REST API to update the progress bar.
     * When the server reports status "completed", finish the scan.
     */
    _pollScanProgress(scanId) {
        this.scanTimer = setInterval(async () => {
            try {
                const progress = await API.getScanStatus(scanId);
                const fill = document.getElementById('scanProgressFill');
                const text = document.getElementById('scanProgressText');
                const count = document.getElementById('scanCount');
                const total = document.getElementById('scanTotal');
                const found = document.getElementById('scanFound');

                const pct = progress.progress || 0;
                const scanned = progress.scanned || 0;
                if (fill) fill.style.width = pct + '%';
                if (count) count.textContent = scanned;
                if (total) total.textContent = progress.total || 0;
                if (found) found.textContent = progress.found || 0;
                // ETA calculation
                const elapsed = this._scanStartTime ? (Date.now() - this._scanStartTime) / 1000 : 0;
                const remainingNum = (progress.total || 1) - scanned;
                const remainingSec = scanned > 0 ? Math.round(elapsed / scanned * Math.max(remainingNum, 0)) : 0;
                const etaMin = Math.floor(remainingSec / 60);
                const etaSec = remainingSec % 60;
                const eta = remainingSec > 0 ? '~'+(etaMin>0?etaMin+'m ':'')+etaSec+'s' : '...';

                if (text) {
                    if (progress.status === 'completed') {
                        text.textContent = T('scan_complete') + ' — ' + (progress.found || 0) + ' ' + T('devices_found');
                    } else {
                        text.innerHTML = T('scanning') + ' ' + scanned + '/' + (progress.total || 0) + ' (' + pct + '%)' + '&emsp;&emsp;ETA: ' + eta;
                    }
                }

                if (progress.status === 'completed') {
                    this._finishScan();
                }
            } catch (e) {
                // If polling fails (e.g. scan was stopped), clean up
                this._finishScan();
            }
        }, 2000);
    },

    /**
     * Load discovered devices from the REST API and populate the cache.
     */
    async loadDiscovered() {
        const table = document.getElementById('discoveredTable');
        if (!table) return;

        try {
            const devices = await API.getDiscoveredDevices();
            this.discoveredCache = devices || [];
            this._renderDiscoveredTable(this.discoveredCache);
        } catch (e) {
            table.innerHTML = `<p class="error-text">${T('load_failed')}: ${e.message}</p>`;
        }
    },

    /**
     * Render the discovered devices table from the given array.
     * Extracted so both the initial API load and real-time WS updates reuse it.
     */
    _renderDiscoveredTable(devices) {
        const table = document.getElementById('discoveredTable');
        if (!table) return;
        const countEl = document.getElementById('discoveredCount');
        if (countEl) countEl.textContent = '(' + (devices ? devices.length : 0) + ')';

        if (!devices || devices.length === 0) {
            table.innerHTML = `
                <div class="empty-state" style="padding:40px 0;">
                    <i class="fas fa-search" style="font-size:40px;color:#ddd;margin-bottom:16px;display:block;"></i>
                    <p style="font-size:14px;color:#999;margin:0;">${T('no_devices')}</p>
                    <p style="font-size:12px;color:#bbb;margin:4px 0 0;">${T('no_devices_hint')}</p>
                </div>`;
            return;
        }

        const cols = ['ip_address','hostname','mac_address','vendor','device_type','os_type','icmp_reachable','snmp_available'];
        const sortKey = this.sortCol || 'ip_address';
        const sorted = [...devices].sort((a,b) => {
            let va = a[sortKey] || '', vb = b[sortKey] || '';
            if (typeof va === 'boolean') { va = va ? 1 : 0; vb = vb ? 1 : 0; }
            // IP address: sort by numeric octets
            if (sortKey === 'ip_address') {
                const pa = String(va).split('.').map(Number);
                const pb = String(vb).split('.').map(Number);
                for (let i=0; i<4; i++) {
                    const da = (pa[i]||0) - (pb[i]||0);
                    if (da !== 0) return this.sortAsc ? da : -da;
                }
                return 0;
            }
            if (typeof va === 'string') { va = va.toLowerCase(); vb = vb.toLowerCase(); }
            if (va < vb) return this.sortAsc ? -1 : 1;
            if (va > vb) return this.sortAsc ? 1 : -1;
            return 0;
        });

        table.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="data-table resizable-table" style="table-layout:fixed;min-width:900px;width:100%;">
                <thead>
                    <tr>
                        ${[
                            {k:'ip_address',l:T('ip_address'),w:'12%'},
                            {k:'hostname',l:T('hostname'),w:'13%'},
                            {k:'mac_address',l:'MAC',w:'12%'},
                            {k:'vendor',l:T('vendor'),w:'13%'},
                            {k:'device_type',l:T('type'),w:'9%'},
                            {k:'os_type',l:'OS',w:'10%'},
                            {k:'icmp_reachable',l:T('icmp'),w:'6%'},
                            {k:'snmp_available',l:T('snmp'),w:'6%'},
                        ].map(c=>'<th style="width:'+c.w+';cursor:pointer;user-select:none;" onclick="DiscoveryPage._sort(\''+c.k+'\')">'+
                            c.l+(sortKey===c.k?(this.sortAsc?' ▲':' ▼'):'')+'</th>').join('')}
                        <th style="width:19%;">${T('actions')}</th>
                    </tr>
                </thead>
                <tbody>
                    ${sorted.map(d => `
                        <tr>
                            <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><code>${Format.esc(d.ip_address)}</code></td>
                            ${(()=>{
                            const spin = '<i class="fas fa-circle-notch fa-spin" style="color:#bbb;font-size:12px;"></i>';
                            return `
                            <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${Format.esc(d.hostname||'')}">${d._loading ? spin : Format.esc(d.hostname || '-')}</td>
                            <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${Format.esc(d.mac_address||'')}"><code style="font-size:11px;">${d._loading ? spin : Format.esc(d.mac_address || '-')}</code></td>
                            <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${Format.esc(d.vendor||'')}">${d._loading ? spin : Format.esc(d.vendor || '-')}</td>
                            <td title="${Format.esc(d.device_type||'')}">${d._loading ? spin : '<span class="badge">'+Format.esc(d.device_type||'unknown')+'</span>'}</td>
                            <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;" title="${Format.esc(d.os_type||'')}">${d._loading ? spin : Format.esc(d.os_type || '-')}</td>`;
                        })()}
                            <td>${d.icmp_reachable ? '<span class="status-badge online">✓</span>' : '<span class="status-badge offline">✗</span>'}</td>
                            <td>${d.snmp_available ? '<span class="status-badge online">✓</span>' : '<span class="status-badge offline">✗</span>'}</td>
                            <td>
                                ${d.approved
                                    ? '<span class="status-badge online">'+T('managed')+'</span>'
                                    : '<button class="btn btn-sm btn-success" onclick="DiscoveryPage.approveDevice(\''+d.id+'\')" title="'+T('approve')+'"><i class="fas fa-check"></i></button>'}
                                <button class="btn btn-sm btn-danger" onclick="DiscoveryPage.rejectDevice('${d.id}')" title="${T('delete')}">
                                    <i class="fas fa-times"></i>
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            </div>
        `;
    },

    async approveDevice(deviceId) {
        try {
            const dev = await API.getDiscoveredDevices();
            const device = dev.find(d => d.id === deviceId);
            if (!device) return;

            const defaultName = device.hostname || device.ip_address || '';
            const defaultType = device.device_type || 'other';
            const defaultCommunity = device.snmp_community || (device.snmp_available ? 'public' : '');

            const deviceTypeOptions = [
                'router', 'switch', 'firewall', 'load_balancer',
                'server_linux', 'server_windows', 'server_unix',
                'wireless_ap', 'wireless_controller',
                'printer', 'ups', 'storage', 'ip_phone', 'camera',
                'other',
            ];

            const typeSelect = deviceTypeOptions.map(t => {
                const label = (CONSTANTS.DEVICE_TYPES[t]?.label || t).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                const sel = t === defaultType ? ' selected' : '';
                return `<option value="${t}"${sel}>${label}</option>`;
            }).join('');

            const modalHtml = `
                <div class="form-group">
                    <label>${T('device_name_label')}</label>
                    <input type="text" id="approveName" class="form-input" value="${Format.esc(defaultName)}"
                           placeholder="${T('device_name')}">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>${T('device_type')}</label>
                        <select id="approveType" class="form-input">${typeSelect}</select>
                        <small>${T('custom_type')}:</small>
                        <input type="text" id="approveTypeCustom" class="form-input"
                               placeholder="${T('custom_type')}" style="margin-top:4px;">
                    </div>
                    <div class="form-group">
                        <label>${T('snmp_community_label')}</label>
                        <input type="text" id="approveCommunity" class="form-input"
                               value="${Format.esc(defaultCommunity)}"
                               placeholder="${device.snmp_available ? T('snmp_community_label') : T('not_detected')}">
                        ${!device.snmp_available ? '<small style="color:#f39c12;">'+T('not_detected')+'</small>' : ''}
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>${T('snmp_version')}</label>
                        <select id="approveSnmpVersion" class="form-input">
                            <option value="1">v1</option>
                            <option value="2c" selected>v2c</option>
                            <option value="3">v3</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>${T('snmp_port')}</label>
                        <input type="number" id="approveSnmpPort" class="form-input" value="161" min="1" max="65535">
                    </div>
                </div>
                <div class="device-info-banner">
                    <strong>${T('discovered_info')}:</strong>
                    IP: ${Format.esc(device.ip_address)} |
                    ${T('vendor')}: ${Format.esc(device.vendor || 'Unknown')} |
                    ${T('icmp')}: ${device.icmp_reachable ? '✓' : '✗'} |
                    ${T('snmp')}: ${device.snmp_available ? '✓' : '✗'}
                </div>
            `;

            const overlay = document.getElementById('modalOverlay');
            const box = document.getElementById('modalBox');
            box.innerHTML = `
                <div class="modal-header">
                    <h3><i class="fas fa-check-circle"></i> ${T('approve_device')}</h3>
                    <button class="modal-close" onclick="App.closeModal()">&times;</button>
                </div>
                <div class="modal-body">${modalHtml}</div>
                <div class="modal-footer">
                    <button class="btn" onclick="App.closeModal()">${T('cancel')}</button>
                    <button class="btn btn-success" id="modalApproveBtn">
                        <i class="fas fa-check"></i> ${T('approve_add')}
                    </button>
                </div>
            `;
            overlay.style.display = 'flex';

            document.getElementById('modalApproveBtn').onclick = async () => {
                const name = document.getElementById('approveName').value.trim();
                if (!name) {
                    App.toast(T('device_name_required'), 'warning');
                    return;
                }

                let deviceType = document.getElementById('approveType').value;
                const customType = document.getElementById('approveTypeCustom').value.trim();
                if (customType) deviceType = customType;

                const community = document.getElementById('approveCommunity').value.trim();
                const snmpEnabled = device.snmp_available && community !== '';
                const snmpVersion = document.getElementById('approveSnmpVersion').value;
                const snmpPort = parseInt(document.getElementById('approveSnmpPort').value) || 161;

                try {
                    await API.approveDevice(deviceId, {
                        name,
                        device_type: deviceType,
                        snmp_community: community || 'public',
                        snmp_version: snmpVersion,
                        snmp_port: snmpPort,
                        snmp_enabled: snmpEnabled,
                    });

                    App.closeModal();
                    App.toast(T('approved_success'), 'success');
                    await this.loadDiscovered();
                } catch (err) {
                    App.toast(T('approve_failed') + ': ' + err.message, 'danger');
                }
            };

        } catch (e) {
            App.toast(T('load_failed') + ': ' + e.message, 'danger');
        }
    },

    async rejectDevice(deviceId) {
        if (!confirm(T('delete_confirm'))) return;
        try {
            await API.deleteDiscoveredDevice(deviceId);
            App.toast(T('device_approved'), 'info');
            await this.loadDiscovered();
        } catch (e) {
            App.toast(T('load_failed') + ': ' + e.message, 'danger');
        }
    },

    _sort(col) {
        if (this.sortCol === col) this.sortAsc = !this.sortAsc;
        else { this.sortCol = col; this.sortAsc = true; }
        this._renderDiscoveredTable(this.discoveredCache);
    },

    async clearAll() {
        if (!confirm(T('delete_confirm'))) return;
        try {
            const devices = await API.getDiscoveredDevices();
            for (const d of devices) {
                await API.deleteDiscoveredDevice(d.id);
            }
            this.discoveredCache = [];
            this._renderDiscoveredTable(this.discoveredCache);
            App.toast(T('clear'), 'info');
        } catch(e) { App.toast(e.message, 'danger'); }
    },

    _initColumnResize() {
        const table = document.querySelector('.resizable-table');
        if (!table) return;
        const ths = table.querySelectorAll('th');
        ths.forEach(th => {
            th.style.position = 'relative';
            const handle = document.createElement('span');
            handle.style.cssText = 'position:absolute;right:0;top:0;bottom:0;width:5px;cursor:col-resize;user-select:none;';
            handle.onmousedown = (e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startW = th.offsetWidth;
                const onMove = (ev) => {
                    const newW = Math.max(40, startW + ev.clientX - startX);
                    th.style.width = newW + 'px';
                    th.style.minWidth = newW + 'px';
                };
                const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            };
            th.appendChild(handle);
        });
    },

};
