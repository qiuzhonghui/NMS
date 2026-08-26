/**
 * Add Device Page — cascading vendor→model→template selection.
 */
const AddDevicePage = {
    allModels: [],
    allTemplates: [],

    async render() {
        document.getElementById('pageContainer').innerHTML = `
        <div class="page-header">
            <h2><i class="fas fa-plus-circle"></i> ${T('add_device')}</h2>
            <p>${T('add_device_desc')}</p>
        </div>
        <div class="card" style="max-width:720px;padding:32px 36px;">
            <form id="addDeviceForm" onsubmit="return false;">
                <div class="form-group" style="margin-bottom:18px;">
                    <label>${T('device_name_label')}</label>
                    <input type="text" id="addName" class="form-input" placeholder="${T('device_name')}" required>
                </div>
                <div class="form-group">
                    <label>${T('ip_address')} *</label>
                    <input type="text" id="addIp" class="form-input" placeholder="192.168.1.1" required>
                </div>
                <div class="form-group">
                    <label>${T('protocol')}</label>
                    <select id="addProtocol" class="form-input" onchange="AddDevicePage._onProtocolChange()">
                        <option value="snmp">SNMP</option><option value="icmp">ICMP</option>
                        <option value="agent">Agent</option><option value="web">Web</option>
                    </select>
                </div>
                <!-- Vendor → Model cascading -->
                <div class="form-row">
                    <div class="form-group" style="flex:1;">
                        <label>${T('vendor')}</label>
                        <select id="addVendor" class="form-input" onchange="AddDevicePage._onVendorChange()">
                            <option value="">-- ${T('select_model_first')} --</option>
                        </select>
                    </div>
                    <div class="form-group" style="flex:2;">
                        <label>${T('device_model')}</label>
                        <select id="addModel" class="form-input" onchange="AddDevicePage._onModelChange()">
                            <option value="">-- ${T('select_model')} --</option>
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>${T('device_type')}</label>
                        <input type="text" id="addDeviceType" class="form-input" placeholder="${T('device_type')}">
                    </div>
                    <div class="form-group">
                        <label>${T('model_name')}</label>
                        <input type="text" id="addModelName" class="form-input" placeholder="${T('model_name')}">
                    </div>
                </div>
                <!-- SNMP -->
                <div id="sectSNMP"><h4>${T('snmp_settings')}</h4>
                    <div class="form-row">
                        <div class="form-group"><label>${T('snmp_version')}</label>
                            <select id="addSnmpVersion" class="form-input">
                                <option value="1">v1</option><option value="2c" selected>v2c</option><option value="3">v3</option>
                            </select></div>
                        <div class="form-group"><label>${T('snmp_community_label')}</label>
                            <input type="text" id="addSnmpCommunity" class="form-input" value="public"></div>
                        <div class="form-group"><label>${T('snmp_port')}</label>
                            <input type="number" id="addSnmpPort" class="form-input" value="161" min="1" max="65535"></div>
                    </div></div>
                <!-- Agent -->
                <div id="sectAgent" style="display:none;"><h4>${T('agent_settings')}</h4>
                    <div class="form-group"><label>${T('agent_port')}</label>
                        <input type="number" id="addAgentPort" class="form-input" value="9090" min="1" max="65535"></div></div>
                <!-- Web -->
                <div id="sectWeb" style="display:none;"><h4>${T('web_settings')}</h4>
                    <div class="form-group"><label>${T('web_port')}</label>
                        <input type="number" id="addWebPort" class="form-input" value="80" min="1" max="65535"></div></div>
                <!-- ICMP -->
                <div id="sectICMP" style="display:none;"><p class="text-muted">${T('icmp_no_extra')}</p></div>
                <h4>${T('additional_settings')}</h4>
                <div class="form-row">
                    <div class="form-group"><label>${T('ssh_port')}</label>
                        <input type="number" id="addSshPort" class="form-input" placeholder="22" min="1" max="65535"></div>
                    <div class="form-group"><label>${T('monitoring_interval')}</label>
                        <input type="number" id="addInterval" class="form-input" value="60" min="10" max="3600">
                        <small>${T('monitoring_interval_hint')}</small></div>
                </div>
                <div class="form-group">
                    <label>${T('monitoring_template')}</label>
                    <select id="addTemplate" class="form-input">
                        <option value="">-- ${T('no_template')} --</option>
                    </select>
                    <small><a href="javascript:void(0)" onclick="AddDevicePage._showNewTemplateForm()">+ ${T('add_rule')}</a></small>
                </div>
                <div class="form-actions" style="margin-top:20px;">
                    <button type="button" class="btn" onclick="App.navigateTo('devices')">${T('cancel')}</button>
                    <button type="button" class="btn btn-primary" id="saveDeviceBtn" onclick="AddDevicePage._save()">
                        <i class="fas fa-save"></i> ${T('add_device_save')}</button>
                </div>
            </form>
            <div id="addDeviceError" style="display:none;color:#e74c3c;margin-top:12px;"></div>
        </div>`;
        await this._loadData();
    },

    destroy() {},

    async _loadData() {
        try {
            const models = await API.getDeviceModels();
            this.allModels = models || [];
            this._populateVendors();
        } catch(e) { console.error(e); }
        try {
            const tmpl = await API.getTemplates();
            this.allTemplates = tmpl || [];
        } catch(e) { console.error(e); }
    },

    _populateVendors() {
        const vendors = [...new Set(this.allModels.map(m => m.vendor).filter(Boolean))].sort();
        const sel = document.getElementById('addVendor');
        if (!sel) return;
        sel.innerHTML = '<option value="">-- ' + T('select_model_first') + ' --</option>';
        vendors.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
    },

    _onVendorChange() {
        const vendor = document.getElementById('addVendor').value;
        const modelSel = document.getElementById('addModel');
        modelSel.innerHTML = '<option value="">-- ' + T('select_model') + ' --</option>';
        if (!vendor) { document.getElementById('addTemplate').innerHTML = '<option value="">-- ' + T('no_template') + ' --</option>'; return; }
        const filtered = this.allModels.filter(m => m.vendor === vendor);
        filtered.forEach(m => {
            const o = document.createElement('option');
            o.value = m.id; o.textContent = m.model_name;
            o.dataset.deviceType = m.device_type; o.dataset.vendor = m.vendor; o.dataset.modelName = m.model_name;
            modelSel.appendChild(o);
        });
    },

    _onModelChange() {
        const opt = document.getElementById('addModel').selectedOptions[0];
        if (!opt || !opt.value) { document.getElementById('addTemplate').innerHTML = '<option value="">-- ' + T('no_template') + ' --</option>'; return; }
        document.getElementById('addDeviceType').value = opt.dataset.deviceType || 'other';
        document.getElementById('addVendor').value = opt.dataset.vendor || '';
        document.getElementById('addModelName').value = opt.dataset.modelName || '';
        this._loadTemplates(opt.value);
    },

    async _loadTemplates(modelId) {
        const sel = document.getElementById('addTemplate');
        sel.innerHTML = '<option value="">-- ' + T('no_template') + ' --</option>';
        try {
            const tmpl = await API.getTemplates(modelId);
            this.allTemplates = tmpl || [];
            tmpl.forEach(t => { const o = document.createElement('option'); o.value = t.id; o.textContent = t.name + ' (' + t.item_count + ' items)'; sel.appendChild(o); });
        } catch(e) { console.error(e); }
    },

    _onProtocolChange() {
        const proto = document.getElementById('addProtocol').value;
        ['sectSNMP','sectAgent','sectWeb','sectICMP'].forEach(id => {
            const el = document.getElementById(id); if (el) el.style.display = 'none';
        });
        const map = {snmp:'sectSNMP',agent:'sectAgent',web:'sectWeb',icmp:'sectICMP'};
        const target = document.getElementById(map[proto]);
        if (target) target.style.display = 'block';
    },

    _showNewTemplateForm() {
        const modelId = document.getElementById('addModel').value;
        if (!modelId) { App.toast(T('select_model_first'), 'warning'); return; }

        App.showModal(T('add_rule'), `
            <div class="form-group"><label>${T('name')}</label>
                <input type="text" id="newTmplName" class="form-input" placeholder="e.g. Basic SNMP Monitor"></div>
            <div class="form-group"><label>${T('monitoring_interval')}</label>
                <input type="number" id="newTmplInterval" class="form-input" value="60" min="10" max="3600"></div>
            <p style="font-size:12px;color:#666;">${T('add_rule')} first, then add monitoring items on the Templates page.</p>
        `, async (box) => {
            const name = box.querySelector('#newTmplName').value.trim();
            if (!name) throw new Error(T('device_name_required'));
            const res = await API.createTemplate({ name, device_model_id: modelId });
            App.toast(T('updated_success'), 'success');
            this._loadTemplates(modelId);
        });
    },

    async _seedModels() {
        try {
            const res = await API.seedDeviceModels();
            App.toast(res.seeded + ' models seeded', 'success');
            await this._loadData();
        } catch(e) { App.toast(T('add_device_failed') + ': ' + e.message, 'danger'); }
    },

    async _save() {
        const name = document.getElementById('addName').value.trim();
        const ip = document.getElementById('addIp').value.trim();
        if (!name) { App.toast(T('device_name_required'), 'warning'); return; }
        if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) { App.toast(T('ip_invalid'), 'warning'); return; }

        const data = {
            name, ip_address: ip,
            protocol: document.getElementById('addProtocol').value,
            device_type: document.getElementById('addDeviceType').value.trim() || 'other',
            model_id: document.getElementById('addModel').value || null,
            template_id: document.getElementById('addTemplate').value || null,
            vendor: document.getElementById('addVendor').value || null,
            model_name: document.getElementById('addModelName').value.trim() || null,
            snmp_version: document.getElementById('addSnmpVersion').value,
            snmp_community: document.getElementById('addSnmpCommunity').value,
            snmp_port: parseInt(document.getElementById('addSnmpPort').value) || 161,
            snmp_enabled: document.getElementById('addProtocol').value === 'snmp',
            agent_port: parseInt(document.getElementById('addAgentPort')?.value) || 9090,
            web_port: parseInt(document.getElementById('addWebPort')?.value) || 80,
            ssh_port: parseInt(document.getElementById('addSshPort').value) || null,
            monitoring_interval: parseInt(document.getElementById('addInterval').value) || 60,
        };

        const btn = document.getElementById('saveDeviceBtn');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + T('saving');
        try {
            const res = await API.manualAddDevice(data);
            App.toast(T('device_added_success') + ': ' + res.name, 'success');
            App.navigateTo('devices');
        } catch(e) {
            document.getElementById('addDeviceError').style.display = 'block';
            document.getElementById('addDeviceError').textContent = e.message;
        } finally {
            btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> ' + T('add_device_save');
        }
    },
};

/**
 * AddDeviceDialog — reusable modal for adding a device from anywhere.
 * Usage: AddDeviceDialog.show()
 */
const AddDeviceDialog = {
    allModels: [], allTemplates: [],

    async show(presets = {}) {
        this.allModels = []; this.allTemplates = [];
        try { this.allModels = await API.getDeviceModels() || []; } catch(e){}
        try { this.allTemplates = await API.getTemplates() || []; } catch(e){}

        const vendors = [...new Set(this.allModels.map(m => m.vendor).filter(Boolean))].sort();
        const vendorOpts = vendors.map(v => `<option value="${v}">${v}</option>`).join('');
        const snmpProfiles = ['','cisco_ios','cisco_nxos','huawei_vrp','h3c_comware','fortinet_fortios','juniper_junos','mikrotik_ros','opnsense','pfsense','openwrt','ikuai','linux_generic','windows_generic'];
        const profileOpts = snmpProfiles.map(p => `<option value="${p}">${p||'Auto'}</option>`).join('');

        const html = `
        <style>
            .add-dialog-form .form-group { margin-bottom:14px; }
            .add-dialog-form label { font-weight:600; font-size:13px; color:#2c3e50; display:block; margin-bottom:4px; }
            .add-dialog-form .form-section { background:#f8f9fa; border:1px solid #e1e5eb; border-radius:8px; padding:14px 16px; margin:14px 0; }
            .add-dialog-form .form-section h4 { margin:0 0 10px; font-size:13px; }
            .add-dialog-form .form-row { display:flex; gap:12px; }
            .add-dialog-form .form-row .form-group { flex:1; }
        </style>
        <div class="add-dialog-form">
            <div class="form-row">
                <div class="form-group"><label>${T('device_name_label')}</label>
                    <input type="text" id="dlgName" class="form-input" value="${presets.name||''}" placeholder="${T('device_name')}"></div>
                <div class="form-group"><label>${T('ip_address')} *</label>
                    <input type="text" id="dlgIp" class="form-input" value="${presets.ip||''}" placeholder="192.168.1.1"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>${T('protocol')}</label>
                    <select id="dlgProtocol" class="form-input" onchange="AddDeviceDialog._toggleSections()">
                        <option value="snmp">SNMP</option><option value="icmp">ICMP</option>
                        <option value="agent">Agent</option><option value="web">Web</option>
                    </select></div>
                <div class="form-group"><label>${T('vendor')}</label>
                    <select id="dlgVendor" class="form-input" onchange="AddDeviceDialog._onVendor()">
                        <option value="">-- ${T('select_model_first')} --</option>${vendorOpts}</select></div>
                <div class="form-group"><label>${T('device_model')}</label>
                    <select id="dlgModel" class="form-input" onchange="AddDeviceDialog._onModel()">
                        <option value="">-- ${T('select_model')} --</option></select></div>
            </div>
            <div class="form-section" id="dlgSNMP"><h4>${T('snmp_settings')}</h4>
                <div class="form-row">
                    <div class="form-group"><label>${T('snmp_version')}</label>
                        <select id="dlgSnmpVer" class="form-input"><option value="1">v1</option><option value="2c" selected>v2c</option><option value="3">v3</option></select></div>
                    <div class="form-group"><label>${T('snmp_community_label')}</label>
                        <input type="text" id="dlgSnmpComm" class="form-input" value="${presets.community||'public'}"></div>
                    <div class="form-group"><label>${T('snmp_port')}</label>
                        <input type="number" id="dlgSnmpPort" class="form-input" value="161"></div>
                </div></div>
            <div class="form-section" id="dlgAgent" style="display:none;"><h4>${T('agent_settings')}</h4>
                <div class="form-group"><label>${T('agent_port')}</label><input type="number" id="dlgAgentPort" class="form-input" value="9090"></div></div>
            <div class="form-section" id="dlgWeb" style="display:none;"><h4>${T('web_settings')}</h4>
                <div class="form-group"><label>${T('web_port')}</label><input type="number" id="dlgWebPort" class="form-input" value="80"></div></div>
            <div class="form-section" id="dlgICMP" style="display:none;"><p class="text-muted">${T('icmp_no_extra')}</p></div>
            <div class="form-row">
                <div class="form-group"><label>${T('ssh_port')}</label><input type="number" id="dlgSshPort" class="form-input" placeholder="22"></div>
                <div class="form-group"><label>${T('monitoring_interval')}</label><input type="number" id="dlgInterval" class="form-input" value="60" min="10"></div>
            </div>
            <div class="form-group"><label>${T('monitoring_template')}</label>
                <select id="dlgTemplate" class="form-input"><option value="">-- ${T('no_template')} --</option></select></div>
            <div id="dlgError" style="display:none;color:#e74c3c;margin-top:8px;"></div>
        </div>`;

        // Manual modal setup for full control over save/close
        const overlay = document.getElementById('modalOverlay');
        const box = document.getElementById('modalBox');
        box.innerHTML = `
            <div class="modal-header"><h3><i class="fas fa-plus-circle"></i> ${T('add_device')}</h3>
                <button class="modal-close" onclick="App.closeModal()">&times;</button></div>
            <div class="modal-body">${html}</div>
            <div class="modal-footer">
                <button class="btn" onclick="App.closeModal()">${T('cancel')}</button>
                <button class="btn btn-primary" id="dlgSaveBtn"><i class="fas fa-save"></i> ${T('add_device_save')}</button>
            </div>`;
        overlay.style.display = 'flex';

        document.getElementById('dlgSaveBtn').onclick = async () => {
            const errEl = document.getElementById('dlgError');
            errEl.style.display = 'none';
            const name = document.getElementById('dlgName').value.trim();
            const ip = document.getElementById('dlgIp').value.trim();
            if (!name) { errEl.style.display='block'; errEl.textContent=T('device_name_required'); return; }
            if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) { errEl.style.display='block'; errEl.textContent=T('ip_invalid'); return; }

            const modelOpt = document.getElementById('dlgModel').selectedOptions[0];
            const data = {
                name, ip_address: ip,
                protocol: document.getElementById('dlgProtocol').value,
                device_type: modelOpt?.dataset?.deviceType || 'other',
                model_id: document.getElementById('dlgModel').value || null,
                template_id: document.getElementById('dlgTemplate').value || null,
                vendor: document.getElementById('dlgVendor').value || null,
                model_name: modelOpt?.dataset?.modelName || null,
                snmp_version: document.getElementById('dlgSnmpVer').value,
                snmp_community: document.getElementById('dlgSnmpComm').value,
                snmp_port: parseInt(document.getElementById('dlgSnmpPort').value)||161,
                snmp_enabled: document.getElementById('dlgProtocol').value==='snmp',
                ssh_port: parseInt(document.getElementById('dlgSshPort').value)||null,
                monitoring_interval: parseInt(document.getElementById('dlgInterval').value)||60,
            };
            try {
                const res = await API.manualAddDevice(data);
                App.closeModal();
                App.toast(T('device_added_success') + ': ' + res.name, 'success');
                if (typeof DevicesPage !== 'undefined' && DevicesPage.loadDevices) DevicesPage.loadDevices();
            } catch(e) {
                errEl.style.display='block'; errEl.textContent = e.message;
            }
        };
    },

    _toggleSections() {
        const proto = document.getElementById('dlgProtocol').value;
        ['dlgSNMP','dlgAgent','dlgWeb','dlgICMP'].forEach(id => { const e=document.getElementById(id); if(e)e.style.display='none'; });
        const map = {snmp:'dlgSNMP',agent:'dlgAgent',web:'dlgWeb',icmp:'dlgICMP'};
        const t = document.getElementById(map[proto]); if(t) t.style.display='block';
    },

    _onVendor() {
        const v = document.getElementById('dlgVendor').value;
        const s = document.getElementById('dlgModel'); s.innerHTML='<option value="">-- '+T('select_model')+' --</option>';
        if (!v) return;
        this.allModels.filter(m=>m.vendor===v).forEach(m=>{
            const o=document.createElement('option'); o.value=m.id; o.textContent=m.model_name;
            o.dataset.deviceType=m.device_type; o.dataset.modelName=m.model_name; s.appendChild(o);
        });
    },

    _onModel() {
        const opt = document.getElementById('dlgModel').selectedOptions[0];
        if (!opt||!opt.value) return;
        const s = document.getElementById('dlgTemplate'); s.innerHTML='<option value="">-- '+T('no_template')+' --</option>';
        this.allTemplates.filter(t=>t.device_model_id===opt.value).forEach(t=>{
            const o=document.createElement('option'); o.value=t.id; o.textContent=t.name; s.appendChild(o);
        });
    },
};
