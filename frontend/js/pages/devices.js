/**
 * Devices Page — list all managed devices with filters and actions.
 */
const DevicesPage = {
    async render() {
        const container = document.getElementById('pageContainer');
        container.innerHTML = `
            <div class="page-header">
                <h2><i class="fas fa-server"></i> ${T('managed_devices')}</h2>
            </div>
            <div class="page-toolbar">
                <div class="page-toolbar-left">
                    <button class="btn btn-primary" onclick="AddDeviceDialog.show()">
                        <i class="fas fa-plus"></i> ${T('add_device')}
                    </button>
                </div>
                <div class="page-toolbar-right">
                    <input type="text" id="deviceSearch" class="form-input" style="width:200px;"
                           placeholder="${T('search_devices')}" oninput="DevicesPage.loadDevices()">
                    <select id="deviceTypeFilter" class="form-input" style="width:140px;"
                            onchange="DevicesPage.loadDevices()">
                        <option value="">${T('all_types')}</option>
                        <option value="router">Router</option><option value="switch">Switch</option>
                        <option value="firewall">Firewall</option><option value="server_linux">Linux</option>
                        <option value="server_windows">Windows</option><option value="other">Other</option>
                    </select>
                    <select id="deviceStatusFilter" class="form-input" style="width:120px;"
                            onchange="DevicesPage.loadDevices()">
                        <option value="">${T('all_status')}</option>
                        <option value="online">${T('online')}</option>
                        <option value="offline">${T('offline')}</option>
                        <option value="warning">${T('warning')}</option>
                    </select>
                    <button class="btn btn-sm" onclick="DevicesPage.loadDevices()">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                </div>
            </div>
            <div class="card" id="devicesTableContainer"><div class="spinner"></div></div>
        `;

        await this.loadDevices();
    },

    destroy() {},

    async loadDevices() {
        const container = document.getElementById('devicesTableContainer');
        if (!container) return;

        const search = document.getElementById('deviceSearch')?.value || '';
        const deviceType = document.getElementById('deviceTypeFilter')?.value || '';
        const status = document.getElementById('deviceStatusFilter')?.value || '';

        try {
            const devices = await API.getDevices({
                search: search || undefined,
                device_type: deviceType || undefined,
                status: status || undefined,
            });

            if (devices.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-server" style="font-size:48px;color:#ccc;margin-bottom:15px;display:block;"></i>
                        <p>${T('no_managed')}</p>
                        <p><a href="#/discovery">${T('go_discovery')}</a></p>
                    </div>`;
                return;
            }

            container.innerHTML = `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>${T('status')}</th>
                            <th>${T('name')}</th>
                            <th>${T('ip_address')}</th>
                            <th>${T('type')}</th>
                            <th>${T('vendor')} / ${T('model')}</th>
                            <th>${T('protocol')}</th>
                            <th>${T('last_seen')}</th>
                            <th>${T('actions')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${devices.map(d => {
                            const label = d.status == 'online' ? 'UP' : d.status == 'offline' ? 'DOWN' : d.status == 'warning' ? 'WARN' : '--';
                            const labelColor = d.status == 'online' ? '#2ecc71' : d.status == 'offline' ? '#e74c3c' : d.status == 'warning' ? '#f39c12' : '#95a5a6';
                            return '<tr>' +
                                '<td><span class="status-indicator status-'+d.status+'"></span> ' +
                                '<span style="color:'+labelColor+';font-weight:600;">'+label+'</span></td>' +
                                '<td><a href="javascript:void(0)" onclick="DevicesPage._quickView(\''+d.id+'\')" class="device-link">'+Format.esc(d.name)+'</a></td>' +
                                '<td><code>'+Format.esc(d.ip_address)+'</code></td>' +
                                '<td><span class="badge badge-'+d.device_type+'">'+T(d.device_type)+'</span></td>' +
                                '<td>'+Format.esc(d.vendor||'-')+' '+Format.esc(d.model||'')+'</td>' +
                                '<td><span style="display:inline-block;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600;text-align:center;background:#e8f4fd;color:#4361ee;">'+(d.protocol||'snmp').toUpperCase()+'</span></td>' +
                                '<td>'+Format.ago(d.last_seen)+'</td>' +
                                '<td>' +
                                '<button class="btn btn-sm btn-primary" onclick="DevicesPage.editDevice(\''+d.id+'\')" title="Edit"><i class="fas fa-edit"></i></button> ' +
                                '<button class="btn btn-sm" onclick="DevicesPage.viewLiveData(\''+d.id+'\')" title="Latest Data"><i class="fas fa-table"></i></button> ' +
                                '<button class="btn btn-sm btn-danger" onclick="DevicesPage.deleteDevice(\''+d.id+'\')" title="Delete"><i class="fas fa-trash"></i></button>' +
                                '</td></tr>';
                        }).join('')}
                    </tbody>
                </table>
            `;
        } catch (e) {
            container.innerHTML = `<p class="error-text">Failed to load devices: ${e.message}</p>`;
        }
    },

    viewDevice(deviceId) {
        App.navigateTo('devices/' + deviceId);
    },

    _onVendorChange() {
        const vendorVal = document.getElementById('editVendor')?.value || '';
        const modelSel = document.getElementById('editModel');
        if (!modelSel || !this._editModels) return;
        const deviceModel = modelSel.getAttribute('data-current') || '';
        const filtered = vendorVal
            ? this._editModels.filter(m=>m.vendor===vendorVal)
            : this._editModels;
        modelSel.innerHTML = '<option value="">-- '+(I18N.t('select_model')||'Select model')+' --</option>' +
            filtered.map(m=>'<option value="'+Format.esc(m.model_name)+'"'+(m.model_name===deviceModel?' selected':'')+'>'+Format.esc(m.model_name)+'</option>').join('');
    },

    async _quickView(deviceId) {
        try {
            const device = await API.getDevice(deviceId);
            const interfaces = await API.getDeviceInterfaces(deviceId).catch(() => []);
            const totalUp = interfaces.filter(i => i.status === 'up').length;
            const totalIf = interfaces.length;

            const icmpInfo = device.icmp_latency_ms != null
                ? device.icmp_latency_ms + ' ms' : (device.icmp_reachable == 1 ? 'reachable' : 'no data');

            const html = `
            <div class="qv-grid">
                <div class="qv-item"><span class="qv-label">${I18N.t('ip_address')}</span><code>${Format.esc(device.ip_address)}</code></div>
                <div class="qv-item"><span class="qv-label">${I18N.t('status')}</span>
                    <span style="color:${device.status==='online'?'#2ecc71':device.status==='offline'?'#e74c3c':'#f39c12'};font-weight:600;">
                    ${device.status.toUpperCase()}</span></div>
                <div class="qv-item"><span class="qv-label">ICMP Ping</span>${icmpInfo}</div>
                <div class="qv-item"><span class="qv-label">${I18N.t('last_seen')}</span>${Format.ago(device.last_seen)}</div>
                <div class="qv-item"><span class="qv-label">${I18N.t('protocol')}</span>${(device.protocol||'snmp').toUpperCase()}</div>
                <div class="qv-item"><span class="qv-label">SNMP</span>${device.snmp_enabled ? '✓ '+I18N.t('enabled')+' (v'+device.snmp_version+')' : '✗ '+I18N.t('disabled')}</div>
                <div class="qv-item"><span class="qv-label">${I18N.t('device_type')}</span>${I18N.t(device.device_type||'other')}</div>
                <div class="qv-item"><span class="qv-label">${I18N.t('vendor')}/${I18N.t('model_name')}</span>${device.vendor||'-'} ${device.model||''}</div>
                <div class="qv-item"><span class="qv-label">${I18N.t('hostname')}</span>${device.hostname||'-'}</div>
                <div class="qv-item"><span class="qv-label">${I18N.t('interfaces')||'Interfaces'}</span>${totalUp}/${totalIf} UP</div>
                <div class="qv-item"><span class="qv-label">SSH</span>${device.ssh_port ? 'Port '+device.ssh_port : '-'}</div>
                <div class="qv-item"><span class="qv-label">Web</span>${device.web_port ? 'Port '+device.web_port : '-'}</div>
            </div>`;

            const overlay = document.getElementById('modalOverlay');
            const box = document.getElementById('modalBox');
            box.innerHTML = `
                <div class="modal-header">
                    <h3><span class="status-indicator status-${device.status}" style="display:inline-block;margin-right:8px;"></span> ${Format.esc(device.name)}</h3>
                    <button class="modal-close" onclick="App.closeModal()">&times;</button>
                </div>
                <div class="modal-body">${html}</div>
                <div class="modal-footer" style="justify-content:flex-start;flex-wrap:wrap;gap:6px;">
                    <button class="btn btn-sm btn-primary" onclick="App.closeModal();App.navigateTo('devices/${device.id}')"><i class="fas fa-chart-line"></i> Dashboard</button>
                    <button class="btn btn-sm" onclick="App.closeModal();DevicesPage.editDevice('${device.id}')"><i class="fas fa-edit"></i> Edit</button>
                    ${device.ssh_port ? '<button class="btn btn-sm" onclick="window.open(\'ssh://'+device.ip_address+':'+(device.ssh_port||22)+'\')"><i class="fas fa-terminal"></i> SSH</button>' : ''}
                    ${device.web_port ? '<button class="btn btn-sm" onclick="window.open(\'http://'+device.ip_address+':'+(device.web_port||80)+'\')"><i class="fas fa-globe"></i> Web</button>' : ''}
                    <button class="btn btn-sm btn-danger" onclick="if(confirm(\'Delete?')){App.closeModal();DevicesPage.deleteDevice('${device.id}')}"><i class="fas fa-trash"></i> Delete</button>
                </div>`;
            overlay.style.display = 'flex';
        } catch(e) {
            App.toast('Failed: ' + e.message, 'danger');
        }
    },

    async editDevice(deviceId) {
        try {
            const device = await API.getDevice(deviceId);
            let allModels = []; try { allModels = await API.getDeviceModels() || []; } catch(e){}

            const typeSelect = (typeof TypeManager !== 'undefined') ? TypeManager.typeOptions(device.device_type) : '';
            const vendors = [...new Set(allModels.map(m=>m.vendor).filter(Boolean))].sort();
            const vendorDatalist = vendors.map(v=>'<option value="'+Format.esc(v)+'">').join('');
            const vendorVal = Format.esc(device.vendor || '');

            // Models for current vendor
            const vendorModels = vendorVal ? allModels.filter(m=>m.vendor===device.vendor) : [];
            const modelDatalist = vendorModels.map(m=>'<option value="'+Format.esc(m.model_name)+'">').join('');
            // Also add ALL models as fallback for initial display
            const allModelDatalist = allModels.map(m=>'<option value="'+Format.esc(m.model_name)+'">').join('');

            const modalHtml = `
                <div class="form-group">
                    <label>${I18N.t('device_name_label')||'Device Name'} <span style="color:red">*</span></label>
                    <input type="text" id="editName" class="form-input" value="${Format.esc(device.name)}">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>${I18N.t('ip_address')}</label>
                        <input type="text" id="editIp" class="form-input" value="${Format.esc(device.ip_address)}">
                    </div>
                    <div class="form-group">
                        <label>${I18N.t('hostname')}</label>
                        <input type="text" id="editHostname" class="form-input" value="${Format.esc(device.hostname || '')}">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>${I18N.t('device_type')}</label>
                        <select id="editType" class="form-input">${typeSelect}</select>
                    </div>
                    <div class="form-group">
                        <label>${I18N.t('vendor')} / ${I18N.t('model')}</label>
                        <div class="form-row">
                            <select id="editVendor" class="form-input" style="flex:1;" onchange="DevicesPage._onVendorChange()">
                                <option value="">-- ${I18N.t('select_model_first')||'Select vendor'} --</option>
                                ${vendors.map(v=>'<option value="'+Format.esc(v)+'"'+(v===device.vendor?' selected':'')+'>'+Format.esc(v)+'</option>').join('')}
                            </select>
                            <select id="editModel" class="form-input" style="flex:1;" data-current="${Format.esc(device.model||'')}">
                                <option value="">-- ${I18N.t('select_model')||'Select model'} --</option>
                            </select>
                        </div>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>${I18N.t('snmp_community_label')||'SNMP Community'}</label>
                        <input type="text" id="editSnmpCommunity" class="form-input" value="${Format.esc(device.snmp_community || '')}">
                    </div>
                    <div class="form-group">
                        <label>${I18N.t('snmp_enabled')||'SNMP'}</label>
                        <select id="editSnmpEnabled" class="form-input">
                            <option value="true" ${device.snmp_enabled ? 'selected' : ''}>${I18N.t('enabled')||'Yes'}</option>
                            <option value="false" ${!device.snmp_enabled ? 'selected' : ''}>${I18N.t('disabled')||'No'}</option>
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>${I18N.t('ssh_port')||'SSH Port'}</label>
                        <input type="number" id="editSshPort" class="form-input" value="${device.ssh_port || 22}" min="1" max="65535">
                    </div>
                    <div class="form-group">
                        <label>${I18N.t('web_port')||'Web Port'}</label>
                        <input type="number" id="editWebPort" class="form-input" value="${device.web_port || 80}" min="1" max="65535">
                    </div>
                </div>
            `;

            // Store models and initialize model dropdown
            this._editModels = allModels;
            // Populate model dropdown initially for current vendor
            setTimeout(() => { this._onVendorChange(); }, 50);

            const overlay = document.getElementById('modalOverlay');
            const box = document.getElementById('modalBox');
            box.innerHTML = `
                <div class="modal-header">
                    <h3><i class="fas fa-edit"></i> ${T('edit_device')}: ${Format.esc(device.name)}</h3>
                    <button class="modal-close" onclick="App.closeModal()">&times;</button>
                </div>
                <div class="modal-body">${modalHtml}</div>
                <div class="modal-footer">
                    <button class="btn" onclick="App.closeModal()">${T('cancel')}</button>
                    <button class="btn btn-primary" id="modalSaveEditBtn">
                        <i class="fas fa-save"></i> ${T('save_changes')}
                    </button>
                </div>
            `;
            overlay.style.display = 'flex';

            document.getElementById('modalSaveEditBtn').onclick = async () => {
                const name = document.getElementById('editName').value.trim();
                if (!name) { App.toast(T('device_name_required'), 'warning'); return; }

                const type = document.getElementById('editType').value;
                const vendor = document.getElementById('editVendor').value || null;
                const modelName = document.getElementById('editModel').value || null;

                // Find model_id from vendor+model_name
                let modelId = null;
                if (vendor && modelName && this._editModels) {
                    const found = this._editModels.find(m=>m.vendor===vendor && m.model_name===modelName);
                    if (found) modelId = found.id;
                }

                try {
                    await API.updateDevice(deviceId, {
                        name,
                        ip_address: document.getElementById('editIp').value.trim() || null,
                        hostname: document.getElementById('editHostname').value.trim() || null,
                        device_type: type,
                        vendor: vendor,
                        model: modelName,
                        model_id: modelId,
                        snmp_community: document.getElementById('editSnmpCommunity').value.trim() || null,
                        snmp_enabled: document.getElementById('editSnmpEnabled').value === 'true',
                        ssh_port: parseInt(document.getElementById('editSshPort').value) || 22,
                        web_port: parseInt(document.getElementById('editWebPort').value) || 80,
                    });
                    App.closeModal();
                    App.toast(name + ' ' + T('updated_success'), 'success');
                    await this.loadDevices();
                } catch (err) {
                    App.toast(T('update_failed') + ': ' + err.message, 'danger');
                }
            };
        } catch (e) {
            App.toast('Failed to load device: ' + e.message, 'danger');
        }
    },

    async deleteDevice(deviceId) {
        if (!confirm('Are you sure you want to delete this device? All metrics and data will be removed.')) return;
        try {
            await API.deleteDevice(deviceId);
            App.toast('Device deleted', 'info');
            await this.loadDevices();
        } catch (e) {
            App.toast('Failed to delete device: ' + e.message, 'danger');
        }
    },

    _liveDataItems: [], _liveUnit: 'auto',

    async viewLiveData(deviceId) {
        try {
            const device = await API.getDevice(deviceId);
            if (!device || !device.snmp_enabled) { App.toast('SNMP not enabled for this device', 'warning'); return; }
            let items = [];
            try {
                const res = await API.get('/devices/'+deviceId+'/live-template-data');
                if (res && Array.isArray(res.items)) items = res.items;
            } catch(e) { console.error('live-template-data error:', e); }
            if (!Array.isArray(items)) items = [];

            if (items.length === 0) {
                try {
                    const metrics = await API.getDeviceMetrics(deviceId, {limit: '20'});
                    if (Array.isArray(metrics)) {
                        const seen = new Set();
                        for (const m of metrics) {
                            if (m && !seen.has(m.metric_name)) {
                                seen.add(m.metric_name);
                                items.push({metric_name: m.metric_name, oid: '', value: m.value||m.avg_value||'-', unit: m.unit||'', display_type: 'text'});
                            }
                        }
                    }
                } catch(e) {}
            }
            this._liveDataItems = items;
            this._liveUnit = 'auto';
            this._renderLiveTable(device.name);
        } catch(e) { App.toast(e.message, 'danger'); console.error('viewLiveData error:', e); }
    },

    _renderLiveTable(deviceName) {
        const items = this._liveDataItems || [];
        const unit = this._liveUnit || 'auto';

        const convertVal = (val, rawUnit) => {
            if (unit === 'auto' || !val || isNaN(val)) return String(val);
            let num = parseFloat(val);
            const u = (rawUnit||'').toLowerCase();
            const isBps = u.includes('bps') || u.includes('octet') || u.includes('byte');
            const isPct = u.includes('%');
            if (isPct) return String(num);
            if (isBps) {
                if (unit === 'mbps') num = num / 1000000;
                else if (unit === 'gbps') num = num / 1000000000;
                else if (unit === 'kbps') num = num / 1000;
                return num.toFixed(2);
            }
            return String(val);
        };

        let walkGroupIdx = 0;
        let rows = items.map((item, idx) => {
            const val = item.value !== undefined ? item.value : '-';
            const displayVal = convertVal(val, item.unit);
            const isWalk = item.walk_results && item.walk_results.length > 0;
            const gid = isWalk ? (walkGroupIdx++) : -1;
            let rowHtml = '';
            // Parent row
            if (isWalk) {
                rowHtml += '<tr class="walk-parent" style="cursor:pointer;background:#f8f9fa;" onclick="DevicesPage._toggleWalkGroup('+gid+')">';
                rowHtml += '<td><i class="fas fa-caret-right" id="walkGrpIcon'+gid+'"></i> <strong>'+Format.esc(item.metric_name)+'</strong> ('+item.walk_results.length+' ports)</td>';
            } else {
                rowHtml += '<tr>';
                rowHtml += '<td><strong>'+Format.esc(item.metric_name)+'</strong></td>';
            }
            rowHtml += '<td><code style="font-size:10px;">'+Format.esc(item.oid||'')+'</code></td>';
            rowHtml += '<td class="live-val" style="font-weight:600;color:#4361ee;cursor:pointer;" data-raw="'+Format.esc(String(val))+'" data-unit="'+Format.esc(item.unit||'')+'" onclick="DevicesPage._cycleUnit(this)" title="Click to change unit">'+Format.esc(displayVal)+'</td>';
            rowHtml += '<td>'+Format.esc(item.unit||'')+'</td>';
            rowHtml += '<td style="font-size:10px;color:#999;">Live</td></tr>';
            // Individual walk result rows (hidden by default)
            if (isWalk) {
                item.walk_results.forEach((wr, wi) => {
                    const wv = convertVal(wr.value, item.unit);
                    rowHtml += '<tr class="walk-sub walkGrp'+gid+'" style="display:none;">';
                    rowHtml += '<td style="padding-left:28px;font-size:11px;">'+Format.esc(wr.oid||'')+'</td>';
                    rowHtml += '<td><code style="font-size:9px;">'+Format.esc(wr.oid||'')+'</code></td>';
                    rowHtml += '<td class="live-val" style="font-weight:600;color:#27ae60;cursor:pointer;" data-raw="'+Format.esc(wr.value||'')+'" data-unit="'+Format.esc(item.unit||'')+'" onclick="DevicesPage._cycleUnit(this)" title="Click to change unit">'+Format.esc(wv)+'</td>';
                    rowHtml += '<td>'+Format.esc(item.unit||'')+'</td>';
                    rowHtml += '<td style="font-size:10px;color:#999;">Live</td></tr>';
                });
            }
            return rowHtml;
        }).join('');
        this._walkData = items;

        const savedPct = localStorage.getItem('nms_modal_pct') || '60';
        const sizeCtrl = `<div style="display:flex;align-items:center;gap:4px;margin-right:24px;">
            <button class="btn btn-sm modal-size-minus" style="padding:2px 5px;font-size:10px;line-height:1;">−</button>
            <input type="range" class="modal-size-slider" min="30" max="90" value="${savedPct}" style="width:80px;accent-color:#4a6cf7;">
            <button class="btn btn-sm modal-size-plus" style="padding:2px 5px;font-size:10px;line-height:1;">+</button></div>`;

        const overlay = document.getElementById('modalOverlay');
        const box = document.getElementById('modalBox');
        box.innerHTML = `<div class="modal-header"><h3><i class="fas fa-table"></i> ${I18N.t('latest_data')||'Latest Data'}: ${Format.esc(deviceName)}</h3>
            ${sizeCtrl}
            <button class="modal-close" onclick="App.closeModal()">&times;</button></div>
            <div class="modal-body" style="max-height:60vh;overflow-y:auto;">
                <div id="liveChart" style="display:none;height:250px;margin-bottom:12px;"><canvas id="liveCanvas"></canvas></div>
                <table class="data-table" style="width:100%;">
                    <thead><tr><th>${I18N.t('metric_name')||'Metric'}</th><th>OID</th><th>${I18N.t('value')||'Value'}</th><th>${I18N.t('unit')||'Unit'}</th><th>${I18N.t('last_seen')||'Updated'}</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="5">No data</td></tr>'}</tbody>
                </table></div>
            <div class="modal-footer">
                <button class="btn btn-sm" onclick="DevicesPage._toggleLiveGraph()"><i class="fas fa-chart-bar"></i> Graph</button>
                <button class="btn" onclick="App.closeModal()">${I18N.t('close')||'Close'}</button></div>`;
        overlay.style.display = 'flex';
        // Slider
        const slider = box.querySelector('.modal-size-slider');
        const applySize = (pct) => { box.style.width = pct + 'vw'; box.style.maxWidth = pct + 'vw'; slider.value = pct; localStorage.setItem('nms_modal_pct', pct); };
        slider.addEventListener('input', () => applySize(slider.value));
        box.querySelector('.modal-size-minus').addEventListener('click', (e) => { e.stopPropagation(); applySize(Math.max(30, parseInt(slider.value)-5)); });
        box.querySelector('.modal-size-plus').addEventListener('click', (e) => { e.stopPropagation(); applySize(Math.min(90, parseInt(slider.value)+5)); });
        applySize(savedPct);
        setTimeout(() => {
            const tbl = box.querySelector('.data-table');
            if (tbl && typeof TableResize !== 'undefined') TableResize.init(tbl);
        }, 100);
    },

    _onUnitChange() {
        if (!this._liveDataItems || !this._liveDataItems.length) return;
        this._liveUnit = document.getElementById('liveUnitSel')?.value || 'auto';
        const convertVal = (raw, unit) => {
            if (unit === 'auto' || !raw || isNaN(raw)) return raw;
            let n = parseFloat(raw);
            if (unit === 'mbps') n = n / 1000000;
            else if (unit === 'gbps') n = n / 1000000000;
            else if (unit === 'kbps') n = n / 1000;
            return n.toFixed(2);
        };
        document.querySelectorAll('.live-val').forEach(el => {
            const raw = el.getAttribute('data-raw') || '';
            el.textContent = convertVal(raw, this._liveUnit);
        });
    },

    _toggleLiveGraph() {
        const chartDiv = document.getElementById('liveChart');
        if (!chartDiv) return;
        if (chartDiv.style.display === 'none') {
            chartDiv.style.display = '';
            this._drawLiveGraph();
        } else {
            chartDiv.style.display = 'none';
        }
    },

    _drawLiveGraph() {
        const canvas = document.getElementById('liveCanvas');
        if (!canvas || typeof Chart === 'undefined') return;
        const items = this._liveDataItems;
        if (!items || !items.length) return;
        const interfaceItem = items.find(i => i.walk_results && i.walk_results.length > 0 && i.walk_results[0].oid?.includes('('));
        if (interfaceItem && interfaceItem.walk_results) {
            const labels = interfaceItem.walk_results.map(w => w.oid?.split('(')[0]?.trim()?.substring(0, 15) || '?');
            const values = interfaceItem.walk_results.map(w => parseFloat(w.value) || 0);
            // Destroy old chart
            if (this._liveChart) this._liveChart.destroy();
            this._liveChart = new Chart(canvas, {
                type: 'bar',
                data: {labels, datasets: [{label: interfaceItem.metric_name, data: values, backgroundColor: '#4a6cf7'}]},
                options: {responsive: true, maintainAspectRatio: false, plugins: {legend: {display: false}}}
            });
        }
    },

    _cycleUnit(el) {
        const raw = parseFloat(el.getAttribute('data-raw'));
        if (isNaN(raw)) return;
        const unit = el.getAttribute('data-unit') || '';
        const curText = el.textContent.trim();
        // Determine current unit from display
        const units = !unit ? [] : unit.toLowerCase().includes('bps') || unit.toLowerCase().includes('octet')
            ? ['bps','Kbps','Mbps','Gbps']
            : unit.toLowerCase().includes('byte') || unit.toLowerCase().includes('b')
            ? ['B','KB','MB','GB','TB']
            : unit.includes('°') || unit.toLowerCase().includes('c')
            ? ['°C','°F']
            : [];
        if (!units.length) return;
        // Find current unit
        let curIdx = 0;
        for (let i = 1; i < units.length; i++) {
            if (curText.toUpperCase().includes(units[i].toUpperCase())) { curIdx = i; break; }
        }
        // Cycle to next
        const nextUnit = units[(curIdx + 1) % units.length];
        let val = raw;
        // Convert to base first
        if (curIdx === 1) val = raw * 1000;       // from K
        else if (curIdx === 2) val = raw * 1000000;  // from M
        else if (curIdx === 3) val = raw * 1000000000; // from G
        else if (curIdx === 4) val = raw * 1000000000000; // from T
        // Convert to target
        if (nextUnit.startsWith('K')) val = val / 1000;
        else if (nextUnit.startsWith('M')) val = val / 1000000;
        else if (nextUnit.startsWith('G')) val = val / 1000000000;
        else if (nextUnit.startsWith('T')) val = val / 1000000000000;
        // Temperature
        if (nextUnit === '°F' && curText.includes('°C')) val = raw * 9/5 + 32;
        else if (nextUnit === '°C' && curText.includes('°F')) val = (raw - 32) * 5/9;
        el.textContent = (typeof val === 'number' ? val.toFixed(2) : val) + ' ' + nextUnit;
    },

    _toggleWalkGroup(gid) {
        const rows = document.querySelectorAll('.walkGrp'+gid);
        const icon = document.getElementById('walkGrpIcon'+gid);
        const visible = rows.length > 0 && rows[0].style.display !== 'none';
        rows.forEach(r => { r.style.display = visible ? 'none' : ''; });
        if (icon) {
            icon.classList.toggle('fa-caret-right', visible);
            icon.classList.toggle('fa-caret-down', !visible);
        }
    },

    _toggleWalk(idx) {
        // Legacy - use _toggleWalkGroup
        this._toggleWalkGroup(idx);
    },

};
