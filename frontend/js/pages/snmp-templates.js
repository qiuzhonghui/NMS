/**
 * SNMP 模板管理页面 — 创建模板、关联 MIB/Cisco 支持列表、管理 OID 监控项。
 * 所有前端文本使用 I18N.t() 支持中英文切换。
 */
const SnmpTemplatesPage = {
    templates: [],
    currentTemplate: null,
    items: [],
    availableOids: [],
    templateDetail: null,

    async render() {
        document.getElementById('pageContainer').innerHTML = `
        <div class="page-header">
            <h2><i class="fas fa-file-code"></i> ${I18N.t('snmp_templates')||'SNMP Templates'}</h2>
        </div>
        <div class="page-toolbar">
            <div class="page-toolbar-left">
                <button class="btn btn-primary" onclick="SnmpTemplatesPage._showCreate()"><i class="fas fa-plus"></i> ${I18N.t('add_template')||'New Template'}</button>
            </div>
        </div>
        <div id="tmplContent"><div class="spinner"></div></div>`;
        await this._loadTemplates();
    },
    destroy() {},

    // ── 加载模板列表 ────────────────────────────────────────────────
    async _loadTemplates() {
        try { this.templates = await API.get('/snmp-templates') || []; }
        catch(e) { this.templates = []; }
        const c = document.getElementById('tmplContent');
        c.innerHTML = this.templates.length === 0
            ? '<div class="empty-state"><p>'+(I18N.t('no_templates')||'No templates')+'</p></div>'
            : this.templates.map(t => `
            <div class="card" style="margin-bottom:12px;padding:14px 20px;cursor:pointer;" onclick="SnmpTemplatesPage._openTemplate('${t.id}')">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <strong>${Format.esc(t.name)}</strong>
                        <span style="color:#999;margin-left:10px;">${t.item_count||0} items</span>
                        ${t.description ? '<br><small style="color:#999;">'+Format.esc(t.description)+'</small>' : ''}
                    </div>
                    <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();SnmpTemplatesPage._deleteTemplate('${t.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </div>`).join('');
    },

    // ── 打开模板详情 ────────────────────────────────────────────────
    async _openTemplate(tid) {
        this.currentTemplate = tid;
        try { this.items = await API.get('/snmp-templates/'+tid+'/items') || []; }
        catch(e) { this.items = []; }

        try { this.templateDetail = await API.get('/snmp-templates/'+tid); }
        catch(e) { this.templateDetail = null; }

        try { this.availableOids = await API.get('/snmp-templates/'+tid+'/available-oids') || []; }
        catch(e) { this.availableOids = []; }

        if (this.availableOids.length === 0 && this.items.length > 0) {
            try {
                const dbOids = await API.get('/snmp-templates/oid-search?q=') || [];
                this.availableOids = dbOids;
            } catch(e) {}
        }

        const t = this.templates.find(x=>x.id===tid);
        const detail = this.templateDetail || {};
        const mibFiles = detail.mib_files || [];
        const ciscoLists = detail.cisco_lists || [];

        let mibBadgeHtml = '';
        if (mibFiles.length > 0) {
            mibBadgeHtml = `<div style="margin-top:6px;font-size:12px;color:#4a6cf7;">
                <i class="fas fa-link"></i> ${I18N.t('linked_mibs')||'Linked MIBs'}: ${mibFiles.map(m=>Format.esc(m.filename)+' ('+m.oid_count+' OIDs)').join(', ')}
            </div>`;
        }
        if (ciscoLists.length > 0) {
            mibBadgeHtml += `<div style="margin-top:3px;font-size:12px;color:#e67e22;">
                <i class="fas fa-list-alt"></i> ${I18N.t('linked_cisco_list')||'Linked Cisco Lists'}: ${ciscoLists.map(c=>Format.esc(c.filename)+' ('+(c.mib_count||0)+' MIBs)').join(', ')}
            </div>`;
        }

        document.getElementById('tmplContent').innerHTML = `
        <div style="margin-bottom:12px;"><a href="javascript:void(0)" onclick="SnmpTemplatesPage.render()">← Back</a></div>
        <div class="card" style="margin-bottom:12px;padding:14px 20px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <div>
                    <h3 style="margin:0;">${Format.esc(t?.name||'Template')} — ${this.items.length} items</h3>
                    ${mibBadgeHtml}
                </div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button class="btn btn-sm" onclick="SnmpTemplatesPage._showAssociateMib()"><i class="fas fa-link"></i> ${I18N.t('associate_mib')||'Link MIB'}</button>
                    <button class="btn btn-sm btn-primary" id="btnAddItem" onclick="SnmpTemplatesPage._showAddItem()"><i class="fas fa-plus"></i> ${I18N.t('add_item')||'Add Item'}</button>
                </div>
            </div>
            ${this.items.length === 0 ? '<p style="color:#999;">'+(I18N.t('no_items')||'No items')+(this.availableOids.length>0?' — <a href="javascript:void(0)" onclick="SnmpTemplatesPage._showAddItem()">'+(I18N.t('add_from_mib')||'Add from linked MIBs')+'</a>':'')+'</p>' : `
            <table class="data-table" style="table-layout:fixed;width:100%;">
                <thead><tr>
                    <th style="width:18%;">${I18N.t('metric_name')||'Metric'}</th><th style="width:24%;">OID</th>
                    <th style="width:18%;">${I18N.t('description')||'Description'}</th>
                    <th style="width:6%;">${I18N.t('unit')||'Unit'}</th><th style="width:8%;">${I18N.t('display')||'Display'}</th>
                    <th style="width:6%;">${I18N.t('interval')||'Interval'}</th><th style="width:6%;">${I18N.t('status')}</th><th style="width:14%;">${I18N.t('actions')}</th>
                </tr></thead><tbody>
                ${this.items.map(i=>{
                    const oidInfo = this.availableOids.find(o=>o.oid===i.oid_or_key);
                    const isZh = (I18N.lang||'zh')==='zh';
                    const desc = oidInfo ? (isZh ? (oidInfo.desc_zh||'') : (oidInfo.desc_en||'')) : '';
                    return `<tr>
                    <td style="overflow:hidden;text-overflow:ellipsis;" title="${Format.esc(i.metric_name)}">${Format.esc(i.metric_name)}</td>
                    <td style="overflow:hidden;text-overflow:ellipsis;"><code style="font-size:10px;" title="${Format.esc(i.oid_or_key)}">${Format.esc(i.oid_or_key)}</code></td>
                    <td style="font-size:11px;color:#666;overflow:hidden;text-overflow:ellipsis;" title="${Format.esc(desc)}">${Format.esc(desc)}</td>
                    <td>${Format.esc(i.unit||'')}</td><td>${I18N.t(i.display_type||'chart')||i.display_type}</td>
                    <td>${i.interval_seconds}s</td>
                    <td>${i.enabled?'<span class="status-badge online">✓</span>':'<span class="status-badge offline">✗</span>'}</td>
                    <td style="white-space:nowrap;">
                        <button class="btn btn-sm" onclick="event.stopPropagation();SnmpTemplatesPage._showEditItem('${tid}','${i.id}')" title="${I18N.t('edit')||'Edit'}"><i class="fas fa-edit"></i></button>
                        <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();SnmpTemplatesPage._deleteItem('${tid}','${i.id}')"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>`;
                }).join('')}
            </tbody></table>`}
        </div>`;
        setTimeout(() => TableResize.initAll(), 100);
    },

    // ── 关联 MIB 文件（标签式多选，点击切换蓝色选中态） ────────────
    _selMib: new Set(),
    _selCisco: new Set(),

    _renderTagList(items, selectedSet, cls) {
        if (items.length === 0) return '<p style="color:#999;padding:6px;">'+(I18N.t('no_items')||'None available')+'</p>';
        return items.map(f => {
            const sel = selectedSet.has(f.id);
            return `<div class="mib-tag ${cls}" data-id="${f.id}" style="display:inline-block;padding:6px 12px;margin:3px;border-radius:6px;cursor:pointer;font-size:12px;transition:all 0.15s;border:1px solid ${sel?'#4a6cf7':'#e1e5eb'};background:${sel?'#eef1fd':'#fff'};color:${sel?'#4a6cf7':'#333'};" onclick="SnmpTemplatesPage._toggleTag(this,'${cls}')">
                ${Format.esc(f.filename)}
                <span style="opacity:0.6;font-size:10px;">(${f.oid_count||f.mib_count||0})</span>
            </div>`;
        }).join('');
    },

    _toggleTag(el, cls) {
        const id = el.getAttribute('data-id');
        if (cls === 'tag-cisco') {
            if (this._selCisco.has(id)) this._selCisco.delete(id);
            else this._selCisco.add(id);
        } else {
            if (this._selMib.has(id)) this._selMib.delete(id);
            else this._selMib.add(id);
        }
        const sel = (cls === 'tag-cisco' ? this._selCisco : this._selMib).has(id);
        el.style.borderColor = sel ? '#4a6cf7' : '#e1e5eb';
        el.style.background = sel ? '#eef1fd' : '#fff';
        el.style.color = sel ? '#4a6cf7' : '#333';
    },

    async _showAssociateMib() {
        let mibFiles = [], ciscoLists = [];
        try { mibFiles = await API.get('/mib-manager/mib-files?file_type=mib') || []; } catch(e) {}
        try { ciscoLists = await API.get('/mib-manager/mib-files?file_type=cisco_list') || []; } catch(e) {}

        const currentMibIds = this.templateDetail?.mib_file_ids || [];
        const currentCiscoIds = this.templateDetail?.cisco_list_ids || [];
        this._selMib = new Set(currentMibIds);
        this._selCisco = new Set(currentCiscoIds);

        App.showModal(I18N.t('associate_mib')||'Link MIB Files', `
            <p style="margin-bottom:8px;color:#666;font-size:13px;">${I18N.t('associate_mib_desc')||'Click items to select/deselect. Blue = linked.'}</p>
            <div style="margin-bottom:12px;">
                <label style="font-weight:600;display:block;margin-bottom:6px;"><i class="fas fa-file-code"></i> ${I18N.t('mib_files')||'MIB Files'}</label>
                <div style="max-height:160px;overflow-y:auto;border:1px solid #e1e5eb;border-radius:6px;padding:6px;" id="mibTagContainer">
                    ${this._renderTagList(mibFiles, this._selMib, 'tag-mib')}
                </div>
            </div>
            <div style="margin-bottom:12px;">
                <label style="font-weight:600;display:block;margin-bottom:6px;"><i class="fas fa-list-alt"></i> ${I18N.t('cisco_list')||'Cisco Support Lists'}</label>
                <div style="max-height:160px;overflow-y:auto;border:1px solid #e1e5eb;border-radius:6px;padding:6px;" id="ciscoTagContainer">
                    ${this._renderTagList(ciscoLists, this._selCisco, 'tag-cisco')}
                </div>
            </div>
        `, async (box) => {
            await API.put('/snmp-templates/'+this.currentTemplate+'/associate-mibs', {
                mib_file_ids: [...this._selMib],
                cisco_list_ids: [...this._selCisco]
            });
            App.toast(I18N.t('updated_success'),'success');
            this._openTemplate(this.currentTemplate);
        });
    },

    // ── 创建模板 ──────────────────────────────────────────────────────
    _showCreate() {
        App.showModal(I18N.t('add_template')||'New Template', `
            <div style="margin-bottom:14px;"><label>${I18N.t('name')}</label><input type="text" id="tmplName" class="form-input" placeholder="e.g. Cisco Switch"></div>
            <div style="margin-bottom:14px;"><label>${I18N.t('description')||'Description'}</label><input type="text" id="tmplDesc" class="form-input" placeholder="Optional"></div>
        `, async (box) => {
            const name = box.querySelector('#tmplName').value.trim();
            if (!name) throw new Error('Name required');
            await API.post('/snmp-templates', {name, description: box.querySelector('#tmplDesc').value.trim()||null});
            App.toast(I18N.t('updated_success'),'success'); this._loadTemplates();
        });
    },

    // ── 编辑监控项（含关联 MIB 描述） ──────────────────────────────────
    async _showEditItem(tid, iid) {
        const item = this.items.find(i => i.id === iid);
        if (!item) return;

        // 从关联 MIB 查找当前 OID 的描述
        const oidInfo = this.availableOids.find(o => o.oid === item.oid_or_key);
        const isZh = (I18N.lang||'zh')==='zh';
        const oidDesc = oidInfo ? (isZh ? (oidInfo.desc_zh||oidInfo.desc_en||'') : (oidInfo.desc_en||oidInfo.desc_zh||'')) : '';

        const displayOpts = [
            {v:'chart',l:I18N.t('line_chart')||'Chart'},{v:'gauge',l:I18N.t('gauge_chart')||'Gauge'},
            {v:'text',l:I18N.t('big_number')||'Text'},{v:'table',l:'Table'},
        ];

        const descHtml = oidDesc ? `<div style="margin-bottom:10px;padding:8px 12px;background:#f0f7ff;border-radius:4px;font-size:12px;color:#2c3e50;">
            <strong>${I18N.t('description')||'Description'}:</strong> ${Format.esc(oidDesc)}
            ${oidInfo?.mib_source ? `<span style="color:#999;margin-left:8px;">(${Format.esc(oidInfo.mib_source)})</span>` : ''}
        </div>` : '';

        App.showModal(I18N.t('edit')||'Edit Item', `
            ${descHtml}
            <div style="margin-bottom:10px;"><label>OID</label><input type="text" id="editOID" class="form-input" value="${Format.esc(item.oid_or_key||'')}"></div>
            <div style="margin-bottom:10px;"><label>${I18N.t('metric_name')||'Metric Name'} *</label><input type="text" id="editName" class="form-input" value="${Format.esc(item.metric_name||'')}"></div>
            <div style="display:flex;gap:12px;margin-bottom:10px;">
                <div style="flex:1;"><label>${I18N.t('unit')||'Unit'}</label><input type="text" id="editUnit" class="form-input" value="${Format.esc(item.unit||'')}"></div>
                <div style="flex:1;"><label>${I18N.t('display')||'Display'}</label><select id="editDisplay" class="form-input">${displayOpts.map(o=>`<option value="${o.v}" ${item.display_type===o.v?'selected':''}>${o.l}</option>`).join('')}</select></div>
                <div style="flex:1;"><label>${I18N.t('interval')||'Interval(s)'}</label><input type="number" id="editInterval" class="form-input" value="${item.interval_seconds||60}"></div>
            </div>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                <input type="checkbox" id="editEnabled" ${item.enabled!==false?'checked':''}> ${I18N.t('enabled')||'Enabled'}
            </label>
        `, async (box) => {
            await API.put('/snmp-templates/'+tid+'/items/'+iid, {
                metric_name: box.querySelector('#editName').value.trim(),
                oid_or_key: box.querySelector('#editOID').value.trim(),
                unit: box.querySelector('#editUnit').value.trim(),
                display_type: box.querySelector('#editDisplay').value,
                interval_seconds: parseInt(box.querySelector('#editInterval').value)||60,
                enabled: box.querySelector('#editEnabled').checked,
            });
            App.toast(I18N.t('updated_success'),'success'); this._openTemplate(tid);
        });
    },

    // ── OID 选择器表格 ────────────────────────────────────────────────

    _filterOIDTable() {
        const q = (document.getElementById('oidSearchInput2')?.value||'').toLowerCase();
        document.querySelectorAll('#oidPickerBody tr').forEach(row => {
            const text = (row.getAttribute('data-search')||'').toLowerCase();
            row.style.display = (!q || text.includes(q)) ? '' : 'none';
        });
    },

    _selectOIDRow(oid, name, descZh, descEn) {
        document.querySelectorAll('#oidPickerBody tr').forEach(r => r.classList.remove('selected'));
        const rows = document.querySelectorAll('#oidPickerBody tr');
        for (const r of rows) {
            if (r.getAttribute('data-oid') === oid) {
                r.classList.add('selected');
                r.scrollIntoView({ block: 'nearest' });
                break;
            }
        }
        const oidEl = document.getElementById('itemOID');
        const nameEl = document.getElementById('itemName');
        if (oidEl) oidEl.value = oid;
        if (nameEl) nameEl.value = name;

        const isZh = (I18N.lang||'zh')==='zh';
        const descDiv = document.getElementById('oidDescDetail');
        if (descDiv) {
            const desc = isZh ? (descZh||descEn||'') : (descEn||descZh||'');
            descDiv.innerHTML = desc || (I18N.t('no_description')||'No description available');
            descDiv.style.display = '';
        }
    },

    async _showAddItem() {
        let mibOids = this.availableOids || [];
        let dbOids = [];
        try { const r = await API.get('/snmp-templates/oid-search?q='); dbOids = r||[]; } catch(e) {}

        const seen = new Set();
        const allOids = [];
        for (const o of [...mibOids, ...dbOids]) {
            if (!seen.has(o.oid)) { seen.add(o.oid); allOids.push(o); }
        }

        const displayOpts = [
            {v:'chart',l:I18N.t('line_chart')||'Chart'},{v:'gauge',l:I18N.t('gauge_chart')||'Gauge'},
            {v:'text',l:I18N.t('big_number')||'Text'},{v:'table',l:'Table'},
        ];
        const isZh = (I18N.lang||'zh')==='zh';
        const descLabel = I18N.t('description')||'Description';
        const nameLabel = I18N.t('name')||'Name';
        const oidLabel = 'OID';

        const rows = allOids.map(o => {
            const desc = isZh ? (o.desc_zh||o.desc_en||'') : (o.desc_en||o.desc_zh||'');
            const searchText = [o.name, o.oid, o.desc_zh, o.desc_en].filter(Boolean).join(' ').toLowerCase();
            return `<tr data-oid="${Format.esc(o.oid)}" data-name="${Format.esc(o.name)}" data-search="${Format.esc(searchText)}" onclick="SnmpTemplatesPage._selectOIDRow('${this._escJs(o.oid)}','${this._escJs(o.name)}','${this._escJs(o.desc_zh||'')}','${this._escJs(o.desc_en||'')}')" title="${Format.esc(desc||'')}">
                <td class="desc-col">${Format.esc(desc||'-')}</td>
                <td class="name-col">${Format.esc(o.name||'')}</td>
                <td class="oid-col"><code style="font-size:10px;">${Format.esc(o.oid||'')}</code></td>
            </tr>`;
        }).join('');

        const mibHint = mibOids.length > 0
            ? `<span style="color:#4a6cf7;font-size:12px;"><i class="fas fa-link"></i> ${mibOids.length} OIDs from linked MIBs</span>`
            : `<span style="color:#999;font-size:12px;">${I18N.t('no_linked_mibs_hint')||'Tip: Link MIB files to see available OIDs with descriptions'}</span>`;

        App.showModal(I18N.t('add_item')||'Add Item', `
            <div style="margin-bottom:10px;">
                <label>${I18N.t('search_oid')||'Search OID'} ${mibHint}</label>
                <input type="text" id="oidSearchInput2" class="form-input" placeholder="Type to filter..." oninput="SnmpTemplatesPage._filterOIDTable()">
            </div>
            <div style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;margin-bottom:10px;">
                <table class="oid-picker-table" id="oidPickerTable">
                    <thead><tr>
                        <th class="desc-col" style="width:40%;">${descLabel}</th>
                        <th class="name-col" style="width:28%;">${nameLabel}</th>
                        <th class="oid-col" style="width:32%;">${oidLabel}</th>
                    </tr></thead>
                    <tbody id="oidPickerBody">${rows}</tbody>
                </table>
            </div>
            <div id="oidDescDetail" style="margin-bottom:10px;padding:8px 12px;background:#f0f7ff;border-radius:4px;font-size:12px;color:#2c3e50;display:none;min-height:20px;"></div>
            <div style="margin-bottom:10px;"><label>OID</label><input type="text" id="itemOID" class="form-input" placeholder="1.3.6.1.4.1.9..."></div>
            <div style="margin-bottom:10px;"><label>${I18N.t('metric_name')||'Metric Name'} *</label><input type="text" id="itemName" class="form-input" placeholder="e.g. cpuUsage"></div>
            <div style="display:flex;gap:12px;margin-bottom:10px;">
                <div style="flex:1;"><label>${I18N.t('unit')||'Unit'}</label><input type="text" id="itemUnit" class="form-input" placeholder="%"></div>
                <div style="flex:1;"><label>${I18N.t('display')||'Display'}</label><select id="itemDisplay" class="form-input">${displayOpts.map(o=>'<option value="'+o.v+'">'+o.l+'</option>').join('')}</select></div>
                <div style="flex:1;"><label>${I18N.t('interval')||'Interval(s)'}</label><input type="number" id="itemInterval" class="form-input" value="60"></div>
            </div>
        `, async (box) => {
            const metricName = box.querySelector('#itemName').value.trim();
            const oidOrKey = box.querySelector('#itemOID').value.trim();
            if (!metricName) { App.toast(I18N.t('metric_name')+' required', 'warning'); throw new Error('Name required'); }
            await API.post('/snmp-templates/'+this.currentTemplate+'/items', {
                metric_name: metricName,
                oid_or_key: oidOrKey,
                unit: box.querySelector('#itemUnit').value.trim(),
                display_type: box.querySelector('#itemDisplay').value,
                interval_seconds: parseInt(box.querySelector('#itemInterval').value)||60,
            });
            App.toast(I18N.t('updated_success'),'success'); this._openTemplate(this.currentTemplate);
        });
        setTimeout(() => TableResize.init(document.getElementById('oidPickerTable')), 100);
    },

    // ── 删除操作 ──────────────────────────────────────────────────────
    async _deleteTemplate(id) { if(!confirm(I18N.t('delete_confirm')))return; await API.del('/snmp-templates/'+id); this._loadTemplates(); },
    async _deleteItem(tid, iid) { if(!confirm(I18N.t('delete_confirm')))return; await API.del('/snmp-templates/'+tid+'/items/'+iid); this._openTemplate(tid); },

    _escJs(s) { if(!s)return''; return s.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); },
};
