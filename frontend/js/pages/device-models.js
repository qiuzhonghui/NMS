/**
 * Device Models & Vendors Page — manage models (CSV import/export) and vendors.
 */
const DeviceModelsPage = {
    models: [],

    // ── Vendor helpers ─────────────────────────────────────────────────
    _getVendors() { const seen=new Set(); const v=[]; for(const m of this.models||[]){const n=(m.vendor||'').trim();if(n&&!seen.has(n.toLowerCase())){seen.add(n.toLowerCase());v.push(n);}} return v.sort(); },
    _getVendorOverrides() { try{return JSON.parse(localStorage.getItem('nms_vendor_overrides')||'{}');}catch(e){return{};} },
    _setVendorOverrides(v) { localStorage.setItem('nms_vendor_overrides', JSON.stringify(v)); },
    _getDeletedVendors() { try{return JSON.parse(localStorage.getItem('nms_deleted_vendors')||'[]');}catch(e){return[];} },
    _modelTemplateData: {},

    async _onModelTemplateTypeChange() {
        const type = document.getElementById('fmTemplateType')?.value;
        const subDiv = document.getElementById('fmTemplateSub');
        const subSel = document.getElementById('fmTemplateSubSelect');
        if (!type) { if (subDiv) subDiv.style.display = 'none'; return; }
        if (subDiv) subDiv.style.display = '';
        // Load templates if not cached
        if (!this._modelTemplateData[type]) {
            try {
                let url = '';
                if (type === 'snmp') url = '/snmp-templates';
                else if (type === 'mib') url = '/mib-manager/mib-files?file_type=mib';
                else if (type === 'cisco') url = '/mib-manager/mib-files?file_type=cisco_list';
                else if (type === 'zabbix') url = '/zabbix-templates';
                if (url) this._modelTemplateData[type] = await API.get(url) || [];
            } catch(e) { this._modelTemplateData[type] = []; }
        }
        const items = this._modelTemplateData[type] || [];
        if (subSel) {
            subSel.innerHTML = '<option value="">-- Select --</option>';
            items.forEach(item => {
                const val = item.id, name = item.name || item.filename || '';
                subSel.innerHTML += '<option value="'+Format.esc(val)+'">'+Format.esc(name)+'</option>';
            });
        }
    },

    _vendorSelectMode: false,
    _selectedVendors: [],

    async render() {
        document.getElementById('pageContainer').innerHTML = `
        <div class="page-header">
            <h2><i class="fas fa-microchip"></i> ${T('device_models_title')}</h2>
        </div>
        <div id="modelsContent"><div class="spinner"></div></div>`;
        await this._loadModels();
    },

    destroy() {},
    _templateNames: {},
    async _loadModels() {
        try { this.models = await API.getDeviceModels() || []; } catch(e) { this.models = []; }
        // Load template names in background
        this._loadTemplateNames();
        this._renderAll();
        if (!this.models.length) document.getElementById('modelsContent').innerHTML = '<p class="error-text">No models</p>';
    },

    async _loadTemplateNames() {
        this._templateNames = {};
        const load = async (type, url, nameField) => {
            try {
                const items = await API.get(url) || [];
                items.forEach(item => {
                    this._templateNames[type+':'+item.id] = item[nameField] || item.filename || item.id;
                });
            } catch(e) {}
        };
        await Promise.all([
            load('snmp', '/snmp-templates', 'name'),
            load('mib', '/mib-manager/mib-files?file_type=mib', 'filename'),
            load('cisco', '/mib-manager/mib-files?file_type=cisco_list', 'filename'),
            load('zabbix', '/zabbix-templates', 'name'),
        ]);
        this._renderAll(); // Re-render with names
    },

    _renderAll() {
        const c = document.getElementById('modelsContent');
        // Vendor overview
        const vendors = this._getVendors();
        const overrides = this._getVendorOverrides();
        const deleted = this._getDeletedVendors();
        const dispVendors = vendors.filter(v => !deleted.includes(v.toLowerCase()));
        const hasOverrides = Object.keys(overrides).length > 0;

        c.innerHTML = `
        ${dispVendors.length > 0 ? `
        <div class="card" style="margin-bottom:16px;padding:14px 20px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <h4 style="margin:0;">📂 ${I18N.t('vendor_mgmt')} <span style="font-weight:400;font-size:12px;color:#999;">(${dispVendors.length})</span></h4>
                <div style="display:flex;gap:4px;">
                    <button class="btn btn-sm ${this._vendorSelectMode?'btn-primary':''}" onclick="DeviceModelsPage._toggleSelect()" id="vendorSelectBtn">${this._vendorSelectMode?I18N.t('cancel'):I18N.t('select_btn')}</button>
                    ${this._vendorSelectMode ? '<button class="btn btn-sm btn-danger" onclick="DeviceModelsPage._deleteVendors()">'+I18N.t('delete')+' ('+this._selectedVendors.length+')</button>' : ''}
                    <button class="btn btn-sm btn-primary" onclick="DeviceModelsPage._addVendor()"><i class="fas fa-plus"></i> ${I18N.t('add_btn')}</button>
                </div>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
                ${dispVendors.map(v => {
                    const name = overrides[v] || v;
                    const sel = this._selectedVendors.includes(v);
                    if (this._vendorSelectMode) {
                        return '<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;font-size:12px;cursor:pointer;'+
                            (sel?'background:#e74c3c;color:#fff;':'background:#e8f4fd;')+
                            '" onclick="DeviceModelsPage._toggleVendor(\''+v.replace(/'/g,"\\'")+'\')">'+
                            (sel?'<b>✓</b> ':'')+Format.esc(name)+'</span>';
                    } else {
                        return '<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:#e8f4fd;border-radius:6px;font-size:12px;cursor:pointer;" onclick="DeviceModelsPage._editVendor(\''+v.replace(/'/g,"\\'")+'\')" title="Click to rename">'+
                            Format.esc(name)+' <i class="fas fa-pen" style="font-size:9px;color:#999;"></i></span>';
                    }
                }).join('')}
            </div>
            ${hasOverrides ? '<p style="font-size:11px;color:#999;margin:6px 0 0;">Renamed vendors shown above.</p>' : ''}
        </div>` : ''}

        <!-- Toolbar -->
        <div class="page-toolbar">
            <div class="page-toolbar-left">
                <button class="btn btn-primary" onclick="DeviceModelsPage._showForm(null)"><i class="fas fa-plus"></i> ${T('add_model')}</button>
                <button class="btn btn-sm" onclick="document.getElementById('csvFileInput').click()" title="${I18N.t('import_hint')}"><i class="fas fa-upload"></i> ${I18N.t('import_btn')}</button>
                <button class="btn btn-sm" onclick="DeviceModelsPage._exportData()" title="${I18N.t('export_hint')}"><i class="fas fa-download"></i> ${I18N.t('export_btn')}</button>
                <input type="file" id="csvFileInput" accept=".csv,.txt" style="display:none;" onchange="DeviceModelsPage._importCSV(this)">
            </div>
            <div class="page-toolbar-right">
                <input type="text" id="modelsSearch" class="form-input" style="width:180px;" placeholder="${T('search_devices')}" oninput="DeviceModelsPage._filter()">
                <button class="btn btn-sm" onclick="DeviceModelsPage._loadModels()"><i class="fas fa-sync-alt"></i></button>
            </div>
        </div>
        <div id="modelList"></div>`;
        this._filter();
    },

    // ── Vendor ──────────────────────────────────────────────────────────

    _addVendor() {
        App.showModal(T('add_vendor'), `
            <div style="margin-bottom:14px;"><label>${T('vendor')} Name</label><input type="text" id="nvName" class="form-input" placeholder="e.g. Aruba, ZTE..."></div>
        `, async (box) => {
            const name = box.querySelector('#nvName').value.trim();
            if (!name) throw new Error('Required');
            // Add a dummy model for this vendor (or just add via override)
            await API.createDeviceModel({ vendor: name, model_name: 'Generic', device_type: 'other', category: 'network' });
            App.toast(T('updated_success'),'success'); this._loadModels();
        });
    },

    _editVendor(key) {
        const overrides = this._getVendorOverrides();
        const curName = overrides[key] || key;
        App.showModal('Edit Vendor: '+key, `
            <div style="margin-bottom:14px;"><label>Display Name</label><input type="text" id="evName" class="form-input" value="${Format.esc(curName)}"></div>
            <p><a href="javascript:void(0)" onclick="DeviceModelsPage._deleteVendor('${key.replace(/'/g,"\\'")}');App.closeModal();" style="color:#e74c3c;">${T('delete')} this vendor (hides all models)</a></p>
        `, async (box) => {
            const name = box.querySelector('#evName').value.trim();
            if (!name) throw new Error('Required');
            if (name !== key) { overrides[key] = name; } else { delete overrides[key]; }
            this._setVendorOverrides(overrides);
            App.toast(T('updated_success'),'success'); this._renderAll();
        });
    },

    _toggleSelect() { this._vendorSelectMode=!this._vendorSelectMode; this._selectedVendors=[]; this._renderAll(); },
    _toggleVendor(v) { const i=this._selectedVendors.indexOf(v); i>=0?this._selectedVendors.splice(i,1):this._selectedVendors.push(v); this._renderAll(); },

    async _deleteVendors() {
        const sel = this._selectedVendors;
        if (!sel.length) { App.toast(I18N.t('no_vendors_selected'),'warning'); return; }
        // Check each vendor's models (case-insensitive exact match)
        const allAffected = [];
        for (const v of sel) {
            const models = (this.models||[]).filter(m=>{
                const mv = (m.vendor||'').trim();
                return mv === v || mv.toLowerCase() === v.toLowerCase();
            });
            if (models.length) allAffected.push({vendor:v, models});
        }
        // Check if any models are used by devices
        let devices = []; try { devices = await API.getDevices()||[]; } catch(e){}
        const usedModels = [];
        for (const a of allAffected) {
            for (const m of a.models) {
                // Match by model_id OR model name OR vendor+model combination
                const devs = devices.filter(d=>
                    d.model_id === m.id ||
                    (d.model && d.model.toLowerCase() === m.model_name.toLowerCase()) ||
                    (d.vendor && m.vendor && d.vendor.toLowerCase() === m.vendor.toLowerCase() && d.model && d.model.toLowerCase() === m.model_name.toLowerCase())
                );
                if (devs.length) usedModels.push({model:m,devices:devs});
            }
        }
        if (usedModels.length) {
            const list = usedModels.map(u=>'<b>'+u.model.model_name+'</b> used by: '+u.devices.map(d=>d.name+'('+d.ip_address+')').join(', ')).join('<br>');
            const overlay=document.getElementById('modalOverlay'),box=document.getElementById('modalBox');
            box.innerHTML='<div class="modal-header"><h3>⚠ '+I18N.t('cannot_delete')+'</h3><button class="modal-close" onclick="App.closeModal()">&times;</button></div>'+
                '<div class="modal-body"><p>'+I18N.t('models_in_use')+':</p><p>'+list+'</p><p style="color:#e74c3c;">'+I18N.t('change_or_delete_first')+'</p></div>'+
                '<div class="modal-footer"><button class="btn btn-primary" onclick="App.closeModal()">'+I18N.t('ok')+'</button></div>';
            overlay.style.display='flex'; return;
        }
        // Confirm deletion
        const count = allAffected.reduce((s,a)=>s+a.models.length,0);
        const msg = (I18N.lang==='zh'
            ? sel.length+' 个厂商将被删除。\n'+(count>0?'同时还将删除旗下 '+count+' 个型号。 ':'')+'确认继续？'
            : sel.length+' vendor(s) selected.\n'+(count>0?'This will also delete '+count+' model(s). ':'')+'Continue?');
        if (!confirm(msg)) return;
        // Delete models then vendors
        for (const a of allAffected) {
            for (const m of a.models) { try { await API.del('/device-models/'+m.id); } catch(e){} }
        }
        // Mark vendors as deleted
        const del = this._getDeletedVendors();
        for (const v of sel) del.push(v.toLowerCase());
        localStorage.setItem('nms_deleted_vendors', JSON.stringify(del));
        this._vendorSelectMode=false; this._selectedVendors=[];
        App.toast((I18N.lang==='zh'
            ? '已删除 '+sel.length+' 个厂商和 '+count+' 个型号'
            : 'Deleted '+sel.length+' vendor(s) and '+count+' model(s)'),'success');
        this._loadModels();
    },

    _deleteVendor(key) {
        const deleted = this._getDeletedVendors();
        deleted.push(key.toLowerCase());
        localStorage.setItem('nms_deleted_vendors', JSON.stringify(deleted));
        this._renderAll();
    },

    // ── Filter ──────────────────────────────────────────────────────────

    _filter() {
        const q = (document.getElementById('modelsSearch')?.value||'').toLowerCase();
        const container = document.getElementById('modelList');
        if (!this.models.length) {
            container.innerHTML = `<div class="empty-state"><p>${T('no_device_models')}</p></div>`;
            return;
        }
        const deleted = this._getDeletedVendors();
        const overrides = this._getVendorOverrides();
        const filtered = q ? this.models.filter(m =>
            (m.vendor||'').toLowerCase().includes(q)||(m.model_name||'').toLowerCase().includes(q)
        ) : this.models;

        const groups = {};
        for (const m of filtered) {
            const rawV = (m.vendor||'Unknown').trim();
            if (deleted.includes(rawV.toLowerCase())) continue;
            const v = overrides[rawV] || rawV;
            if (!groups[v]) groups[v] = [];
            groups[v].push(m);
        }
        const cols = 'style="width:30%;"|style="width:16%;"|style="width:12%;"|style="width:22%;"|style="width:20%;"'.split('|');
        let html = '';
        for (const vendor of Object.keys(groups).sort()) {
            html += `<div class="card" style="margin-bottom:14px;padding:16px 20px;"><h4 style="margin:0 0 10px;">${Format.esc(vendor)} (${groups[vendor].length})</h4>
                <table class="data-table" style="table-layout:fixed;width:100%;"><thead><tr>
                    <th ${cols[0]}>${T('model_name')}</th><th ${cols[1]}>${T('device_type')}</th><th ${cols[2]}>${T('category')}</th><th ${cols[3]}>${I18N.t('snmp_templates')||'SNMP Tmpl'}</th><th ${cols[4]}>${T('actions')}</th>
                </tr></thead><tbody>`;
            for (const m of groups[vendor]) {
                const nameKey = m.template_type + ':' + m.template_ref_id;
                const tmplName = this._templateNames[nameKey] || (m.template_ref_id||'').substring(0,8);
                const tmplLabel = m.template_type ? (m.template_type.toUpperCase() + ': ' + tmplName) : '-';
                html += `<tr>
                    <td ${cols[0]}><strong>${Format.esc(m.model_name)}</strong></td>
                    <td ${cols[1]}>${T(m.device_type)}</td><td ${cols[2]}>${T(m.category==='network'?'network_label':m.category==='server'?'server_label':'custom_label')}</td>
                    <td ${cols[3]}><code>${Format.esc(tmplLabel)}</code></td>
                    <td ${cols[4]}>
                        <button class="btn btn-sm" onclick="DeviceModelsPage._showForm('${m.id}')"><i class="fas fa-edit"></i></button>
                        <button class="btn btn-sm btn-danger" onclick="DeviceModelsPage._deleteModel('${m.id}')"><i class="fas fa-trash"></i></button>
                    </td></tr>`;
            }
            html += '</tbody></table></div>';
        }
        container.innerHTML = html || '<div class="empty-state"><p>No matches</p></div>';
    },

    // ── Form (Add / Edit) ───────────────────────────────────────────────

    _showForm(id) {
        const model = id ? this.models.find(x=>x.id===id) : null;
        const isEdit = !!model;
        const v = model ? model.vendor : '', mn = model ? model.model_name : '';
        const dt = model ? model.device_type : 'other', cat = model ? (model.category||'network') : 'network';
        const sp = model ? (model.snmp_profile||'') : '';
        App.showModal(isEdit ? T('edit') : T('add_model'), `
            <div style="margin-bottom:14px;"><label>${T('vendor')} *</label><input type="text" id="fmVendor" class="form-input" value="${Format.esc(v)}"></div>
            <div style="margin-bottom:14px;"><label>${T('model_name')} *</label><input type="text" id="fmModelName" class="form-input" value="${Format.esc(mn)}"></div>
            <div style="display:flex;gap:12px;margin-bottom:14px;">
                <div style="flex:1;"><label>${T('device_type')}</label><select id="fmDeviceType" class="form-input">${TypeManager?TypeManager.typeOptions(dt):''}</select></div>
                <div style="flex:1;"><label>${T('category')}</label><select id="fmCategory" class="form-input">${TypeManager?TypeManager.catOptions(cat):''}</select></div></div>
            <div style="margin-bottom:14px;"><label>Template Type</label>
                <select id="fmTemplateType" class="form-input" onchange="DeviceModelsPage._onModelTemplateTypeChange()">
                    <option value="">-- None --</option><option value="snmp">SNMP Template</option>
                    <option value="mib">MIB File</option><option value="cisco">Cisco List</option>
                    <option value="zabbix">Zabbix Template</option></select></div>
            <div class="form-group" id="fmTemplateSub" style="${model?.template_type?'':'display:none;'}">
                <label id="fmTemplateSubLabel">Template</label>
                <select id="fmTemplateSubSelect" class="form-input"><option value="">-- Select --</option></select></div>
        `, async (box) => {
            const vendor = box.querySelector('#fmVendor').value.trim();
            const model_name = box.querySelector('#fmModelName').value.trim();
            if (!vendor||!model_name) throw new Error('Vendor and model name required');
            const data = { vendor, model_name, device_type: box.querySelector('#fmDeviceType').value, category: box.querySelector('#fmCategory').value, snmp_profile: null, template_type: box.querySelector('#fmTemplateType')?.value||null, template_ref_id: box.querySelector('#fmTemplateSubSelect')?.value||null };
            if (isEdit) {
                await API.put('/device-models/'+model.id, data);
            } else {
                // Check duplicate: same vendor+model
                const dup = this.models.find(m => m.vendor===vendor && m.model_name===model_name);
                if (dup) { App.toast('Model already exists: '+vendor+' '+model_name, 'warning'); return; }
                await API.createDeviceModel(data);
            }
            App.toast(T('updated_success'),'success'); this._loadModels();
        });
        // Initialize template dropdown if model has saved template
        if (model?.template_type) {
            setTimeout(() => {
                const typeSel = document.getElementById('fmTemplateType');
                if (typeSel) typeSel.value = model.template_type;
                DeviceModelsPage._onModelTemplateTypeChange();
                setTimeout(() => {
                    const subSel = document.getElementById('fmTemplateSubSelect');
                    if (subSel && model.template_ref_id) subSel.value = model.template_ref_id;
                }, 300);
            }, 100);
        }
    },

    async _deleteModel(id) { if(!confirm(T('delete_confirm')))return; try{await API.del('/device-models/'+id);App.toast('OK','info');this._loadModels();}catch(e){App.toast(e.message,'danger');} },
    // ── CSV ─────────────────────────────────────────────────────────────

    _exportData() {
        if (!this.models.length) { App.toast('No data','warning'); return; }
        const overlay = document.getElementById('modalOverlay'), box = document.getElementById('modalBox');
        box.innerHTML = `<div class="modal-header"><h3>${T('export_btn')||'导出'}</h3><button class="modal-close" onclick="App.closeModal()">&times;</button></div>
            <div class="modal-body"><p style="margin-bottom:12px;">${T('export_hint')}</p>
                <label style="display:flex;align-items:center;gap:8px;padding:8px;margin:4px 0;cursor:pointer;border-radius:4px;">
                    <input type="radio" name="expFmt" value="csv" checked> CSV (${T('export_csv')})</label>
                <label style="display:flex;align-items:center;gap:8px;padding:8px;margin:4px 0;cursor:pointer;border-radius:4px;">
                    <input type="radio" name="expFmt" value="txt"> TXT (Tab-separated)</label></div>
            <div class="modal-footer"><button class="btn" onclick="App.closeModal()">${T('cancel')}</button>
                <button class="btn btn-primary" id="expDoBtn"><i class="fas fa-download"></i> ${T('export_btn')||'导出'}</button></div>`;
        overlay.style.display = 'flex';
        document.getElementById('expDoBtn').onclick = () => {
            const isCsv = document.querySelector('input[name="expFmt"]:checked').value === 'csv';
            const header = isCsv ? 'vendor,model_name,device_type,category,snmp_profile' : 'vendor\tmodel_name\tdevice_type\tcategory\tsnmp_profile';
            const rows = this.models.map(m => isCsv
                ? `${this._csv(m.vendor)},${this._csv(m.model_name)},${this._csv(m.device_type)},${this._csv(m.category)},${this._csv(m.snmp_profile||'')}`
                : `${m.vendor||''}\t${m.model_name||''}\t${m.device_type||''}\t${m.category||''}\t${m.snmp_profile||''}`);
            const text = header+'\n'+rows.join('\n');
            const type = isCsv ? 'text/csv;charset=utf-8;' : 'text/plain;charset=utf-8;';
            const blob = new Blob([isCsv?'﻿':'',text], {type:type});
            const url = URL.createObjectURL(blob), a = document.createElement('a');
            a.href=url; a.download='device_models.'+(isCsv?'csv':'txt'); a.click(); URL.revokeObjectURL(url);
            App.closeModal();
        };
    },

    async _importCSV(input) {
        const file = input.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            const lines = e.target.result.split('\n').filter(l=>l.trim());
            if (lines.length < 2) { App.toast('Empty CSV','warning'); return; }
            let created = 0, updated = 0, skipped = 0;
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split(',');
                if (parts.length < 3) continue;
                const vendor = parts[0].trim(), model_name = parts[1].trim();
                if (!vendor || !model_name) continue;
                try {
                    // Check for existing model with same vendor+name
                    const existing = this.models.find(m => m.vendor===vendor && m.model_name===model_name);
                    const data = { vendor, model_name, device_type: (parts[2]||'').trim()||'other', category: (parts[3]||'').trim()||'network', snmp_profile: (parts[4]||'').trim()||null };
                    if (existing) {
                        await API.put('/device-models/'+existing.id, data);
                        updated++;
                    } else {
                        await API.createDeviceModel(data);
                        created++;
                    }
                } catch(er) { skipped++; }
            }
            App.toast(`Created: ${created}, Updated: ${updated}, Skipped: ${skipped}`, 'success');
            this._loadModels();
        };
        reader.readAsText(file); input.value = '';
    },

    _csv(s) { const v=(s||'').replace(/"/g,'""'); return /[,"\n]/.test(v)?'"'+v+'"':v; },

};
