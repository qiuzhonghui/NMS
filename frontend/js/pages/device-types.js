/**
 * Device Types & Categories Page — manage types and categories.
 */
const DeviceTypesPage = {
    _get(k,def) { try{const v=JSON.parse(localStorage.getItem(k)||'null');return v!=null?v:(def!==undefined?def:{});}catch(e){return def!==undefined?def:{};} },
    _set(k,v) { localStorage.setItem(k, JSON.stringify(v)); },

    _defaultCats: [
        {key:'network',zh:'网络设备',en:'Network'},
        {key:'server',zh:'服务器',en:'Server'},
        {key:'custom',zh:'自定义',en:'Custom'},
    ],
    _builtinTypes: [
        {key:'router',zh:'路由器',en:'Router',cat:'network'},
        {key:'switch',zh:'交换机',en:'Switch',cat:'network'},
        {key:'firewall',zh:'防火墙',en:'Firewall',cat:'network'},
        {key:'load_balancer',zh:'负载均衡',en:'Load Balancer',cat:'network'},
        {key:'wireless_ap',zh:'无线AP',en:'Wireless AP',cat:'network'},
        {key:'wireless_controller',zh:'无线控制器',en:'Wireless Controller',cat:'network'},
        {key:'server_linux',zh:'Linux服务器',en:'Linux Server',cat:'server'},
        {key:'server_windows',zh:'Windows服务器',en:'Windows Server',cat:'server'},
        {key:'printer',zh:'打印机',en:'Printer',cat:'custom'},
        {key:'ups',zh:'UPS电源',en:'UPS',cat:'custom'},
        {key:'storage',zh:'存储设备',en:'Storage',cat:'custom'},
        {key:'ip_phone',zh:'IP电话',en:'IP Phone',cat:'custom'},
        {key:'camera',zh:'摄像头',en:'Camera',cat:'custom'},
        {key:'other',zh:'其他设备',en:'Other Device',cat:'custom'},
    ],

    // ── Deleted items tracking ──────────────────────────────────────────
    _deletedCats() { return this._get('nms_deleted_cats',[]); },
    _deletedTypes() { return this._get('nms_deleted_types',[]); },

    // ── Categories (with overrides + custom additions + deletions) ─────
    _allCats() {
        const ov = this._get('nms_cats_overrides',{});
        const added = this._get('nms_cats_added',[]);
        const deleted = this._deletedCats();
        let cats = [...this._defaultCats];
        // Apply overrides
        for (const k of Object.keys(ov)) {
            const idx = cats.findIndex(c=>c.key===k);
            if (idx>=0) cats[idx] = {...cats[idx],...ov[k]};
        }
        // Add custom
        cats = cats.concat(added);
        // Filter deleted
        cats = cats.filter(c=>!deleted.includes(c.key));
        return cats;
    },

    _allTypes() {
        const ov = this._get('nms_type_overrides',{});
        const custom = this._get('nms_device_types',[]);
        const deleted = this._deletedTypes();
        let types = [...this._builtinTypes];
        for (const k of Object.keys(ov)) {
            const idx = types.findIndex(t=>t.key===k);
            if (idx>=0) types[idx] = {...types[idx],...ov[k]};
        }
        types = types.concat(custom.map(t=>({...t, cat:t.category||t.cat||'custom', isCustom:true})));
        return types.filter(t=>!deleted.includes(t.key));
    },

    _catLabel(cat) {
        const c = this._allCats().find(x=>x.key===cat);
        return c ? (I18N.lang==='zh'?c.zh:c.en) : cat;
    },

    // ══════════════════════════════════════════════════════════════════
    //  RENDER
    // ══════════════════════════════════════════════════════════════════

    async render() {
        const cats = this._allCats();
        const types = this._allTypes();
        const lang = I18N.lang||'zh';
        document.getElementById('pageContainer').innerHTML = `
        <div class="page-header">
            <h2><i class="fas fa-tags"></i> ${T('device_types_custom')}</h2>
        </div>

        <!-- Category Management -->
        <div class="card" style="margin-bottom:20px;padding:16px 20px;">
            <h4 style="margin:0;">📂 ${T('category_mgmt')}</h4>
            <div class="page-toolbar" style="margin:8px 0 12px;padding:0;border:none;background:none;">
                <div class="page-toolbar-left">
                    <button class="btn btn-primary btn-sm" onclick="DeviceTypesPage._addCat()"><i class="fas fa-plus"></i> ${T('add_category')}</button>
                </div>
            </div>
            <table class="data-table" style="table-layout:fixed;width:100%;">
                <thead><tr>
                    <th style="width:16%;">Key</th><th style="width:20%;">中文</th><th style="width:20%;">English</th><th style="width:14%;"></th><th style="width:10%;">Type</th><th style="width:20%;">${T('actions')}</th>
                </tr></thead><tbody>
                ${cats.map(c => {
                    const isBuiltin = this._defaultCats.find(x=>x.key===c.key);
                    return '<tr><td><code>'+Format.esc(c.key)+'</code></td>'+
                        '<td>'+Format.esc(c.zh)+'</td><td>'+Format.esc(c.en)+'</td>'+
                        '<td></td>'+
                        '<td>'+(isBuiltin?'<span style="color:#999;">Built-in</span>':'<span style="color:#2ecc71;">Custom</span>')+'</td>'+
                        '<td>'+
                        '<button class="btn btn-sm" onclick="DeviceTypesPage._editCat(\''+c.key+'\')"><i class="fas fa-edit"></i></button> '+
                        '<button class="btn btn-sm btn-danger" onclick="DeviceTypesPage._deleteCat(\''+c.key+'\')"><i class="fas fa-trash"></i></button>'+
                        '</td></tr>';
                }).join('')}
            </tbody></table>
        </div>

        <!-- Type Management -->
        <div class="card" style="padding:16px 20px;">
            <h4 style="margin:0;">🏷️ ${T('device_types_custom')}</h4>
            <div class="page-toolbar" style="margin:8px 0 12px;padding:0;border:none;background:none;">
                <div class="page-toolbar-left">
                    <button class="btn btn-primary btn-sm" onclick="DeviceTypesPage._showAddType()"><i class="fas fa-plus"></i> ${T('add_type')}</button>
                </div>
            </div>
            <table class="data-table" style="table-layout:fixed;width:100%;">
                <thead><tr>
                    <th style="width:16%;">Key</th><th style="width:20%;">中文</th><th style="width:20%;">English</th><th style="width:14%;">${T('category')}</th><th style="width:10%;">Type</th><th style="width:20%;">${T('actions')}</th>
                </tr></thead><tbody>
                ${types.map(t => {
                    const isBuiltin = this._builtinTypes.find(x=>x.key===t.key);
                    return '<tr><td><code>'+Format.esc(t.key)+'</code></td>'+
                        '<td>'+Format.esc(t.zh)+'</td><td>'+Format.esc(t.en)+'</td>'+
                        '<td>'+this._catLabel(t.cat||t.category)+'</td>'+
                        '<td>'+(t.isCustom?'<span style="color:#2ecc71;">Custom</span>':'<span style="color:#999;">Built-in</span>')+'</td>'+
                        '<td>'+
                        '<button class="btn btn-sm" onclick="DeviceTypesPage._editType(\''+t.key+'\')"><i class="fas fa-edit"></i></button> '+
                        '<button class="btn btn-sm btn-danger" onclick="DeviceTypesPage._deleteType(\''+t.key+'\')"><i class="fas fa-trash"></i></button>'+
                        '</td></tr>';
                }).join('')}
            </tbody></table>
        </div>`;
    },

    destroy() {},

    // ── Category CRUD ──────────────────────────────────────────────────

    _addCat() {
        App.showModal(T('add_category'), `
            <div class="form-group" style="margin-bottom:14px;"><label>Key</label><input type="text" id="catKey" class="form-input" placeholder="e.g. iot"></div>
            <div style="display:flex;gap:12px;margin-bottom:14px;"><div style="flex:1;"><label>中文</label><input type="text" id="catZh" class="form-input"></div><div style="flex:1;"><label>English</label><input type="text" id="catEn" class="form-input"></div></div>
        `, async (box) => {
            const key=box.querySelector('#catKey').value.trim().replace(/[^a-z0-9_]/g,''), zh=box.querySelector('#catZh').value.trim(), en=box.querySelector('#catEn').value.trim();
            if(!key||!zh||!en) throw new Error('All fields required');
            const added=this._get('nms_cats_added',[]);
            if(this._allCats().find(c=>c.key===key)) throw new Error('Key exists');
            // If previously deleted, restore it (just remove from deleted list, don't duplicate)
            const deleted = this._deletedCats();
            if (deleted.includes(key)) {
                this._set('nms_deleted_cats', deleted.filter(k=>k!==key));
                App.toast(T('updated_success'),'success'); this.render();
                return;
            }
            added.push({key,zh,en}); this._set('nms_cats_added',added);
            App.toast(T('updated_success'),'success'); this.render();
        });
    },

    _editCat(key) {
        const c=this._allCats().find(x=>x.key===key); if(!c)return;
        App.showModal('Edit: '+key, `
            <div style="display:flex;gap:12px;margin-bottom:14px;"><div style="flex:1;"><label>中文</label><input type="text" id="ecatZh" class="form-input" value="${c.zh||''}"></div><div style="flex:1;"><label>English</label><input type="text" id="ecatEn" class="form-input" value="${c.en||''}"></div></div>
        `, async (box) => {
            const zh=box.querySelector('#ecatZh').value.trim(), en=box.querySelector('#ecatEn').value.trim();
            const ov=this._get('nms_cats_overrides',{}); ov[key]={zh,en}; this._set('nms_cats_overrides',ov);
            App.toast(T('updated_success'),'success'); this.render();
        });
    },

    async _deleteCat(key) {
        // Block if any type belongs to this category
        const typesUsingCat = this._allTypes().filter(t=>(t.cat||t.category)===key);
        if (typesUsingCat.length > 0) {
            const typeNames = typesUsingCat.map(t=>'<code>'+t.key+'</code> ('+(t.zh||t.en)+')').join(', ');
            let devicesUsing = [];
            try { const devs = await API.getDevices() || []; devicesUsing = devs.filter(d=>typesUsingCat.some(t=>t.key===d.device_type)); } catch(e){}
            const devList = devicesUsing.length > 0
                ? '<p style="margin-top:10px;">📋 '+T('delete_cat_hint')+'</p>'+devicesUsing.map(d=>'<div style="margin:3px 0;">• <b>'+d.name+'</b> ('+d.ip_address+') — '+d.device_type+'</div>').join('')
                : '';
            const overlay=document.getElementById('modalOverlay'), box=document.getElementById('modalBox');
            box.innerHTML='<div class="modal-header"><h3>⚠ '+T('delete_blocked')+'</h3><button class="modal-close" onclick="App.closeModal()">&times;</button></div>'+
                '<div class="modal-body"><p>'+T('cat_has_types').replace('{count}',typesUsingCat.length).replace('{types}',typeNames)+'</p>'+devList+
                '<p style="margin-top:12px;color:#e74c3c;">'+T('delete_type_hint2')+'</p></div>'+
                '<div class="modal-footer"><button class="btn btn-primary" onclick="App.closeModal()">OK</button></div>';
            overlay.style.display='flex'; return;
        }
        if(!confirm(T('delete_confirm')))return;
        const d=this._deletedCats(); d.push(key); this._set('nms_deleted_cats',d);
        const added=this._get('nms_cats_added',[]); this._set('nms_cats_added',added.filter(c=>c.key!==key));
        const ov=this._get('nms_cats_overrides',{}); delete ov[key]; this._set('nms_cats_overrides',ov);
        this.render();
    },

    // ── Type CRUD ──────────────────────────────────────────────────────

    _showAddType() {
        const cats=this._allCats();
        App.showModal(T('add_type'), `
            <div style="margin-bottom:14px;"><label>Key <small>(lowercase)</small></label><input type="text" id="ntKey" class="form-input" placeholder="e.g. nas_device"></div>
            <div style="display:flex;gap:12px;margin-bottom:14px;"><div style="flex:1;"><label>中文</label><input type="text" id="ntZh" class="form-input"></div><div style="flex:1;"><label>English</label><input type="text" id="ntEn" class="form-input"></div></div>
            <div style="margin-bottom:14px;"><label>${T('category')}</label><select id="ntCat" class="form-input">${cats.map(c=>'<option value="'+c.key+'">'+(I18N.lang==='zh'?c.zh:c.en)+'</option>').join('')}</select></div>
        `, async (box) => {
            const key=box.querySelector('#ntKey').value.trim().replace(/[^a-z0-9_]/g,''), zh=box.querySelector('#ntZh').value.trim(), en=box.querySelector('#ntEn').value.trim(), cat=box.querySelector('#ntCat').value;
            if(!key||!zh||!en) throw new Error('All fields required');
            const types=this._get('nms_device_types',[]);
            if(this._allTypes().find(t=>t.key===key)) throw new Error('Key exists');
            // If previously deleted, restore it (just remove from deleted list)
            const deleted = this._deletedTypes();
            if (deleted.includes(key)) {
                this._set('nms_deleted_types', deleted.filter(k=>k!==key));
                App.toast(T('updated_success'),'success'); this.render();
                return;
            }
            types.push({key,zh,en,category:cat}); this._set('nms_device_types',types);
            App.toast(T('updated_success'),'success'); this.render();
        });
    },

    _editType(key) {
        const t=this._allTypes().find(x=>x.key===key); if(!t)return;
        const cats=this._allCats();
        App.showModal('Edit: '+key, `
            <div style="display:flex;gap:12px;margin-bottom:14px;"><div style="flex:1;"><label>中文</label><input type="text" id="etZh" class="form-input" value="${t.zh||''}"></div><div style="flex:1;"><label>English</label><input type="text" id="etEn" class="form-input" value="${t.en||''}"></div></div>
            <div style="margin-bottom:14px;"><label>${T('category')}</label><select id="etCat" class="form-input">${cats.map(c=>'<option value="'+c.key+'" '+((t.cat||t.category)===c.key?'selected':'')+'>'+(I18N.lang==='zh'?c.zh:c.en)+'</option>').join('')}</select></div>
        `, async (box) => {
            const zh=box.querySelector('#etZh').value.trim(), en=box.querySelector('#etEn').value.trim(), cat=box.querySelector('#etCat').value;
            if (t.isCustom) {
                const types=this._get('nms_device_types',[]); const idx=types.findIndex(x=>x.key===key);
                if(idx>=0){types[idx].zh=zh;types[idx].en=en;types[idx].category=cat;} this._set('nms_device_types',types);
            } else {
                const ov=this._get('nms_type_overrides',{}); ov[key]={zh,en,cat}; this._set('nms_type_overrides',ov);
            }
            App.toast(T('updated_success'),'success'); this.render();
        });
    },

    async _deleteType(key) {
        let devices = []; try { devices = await API.getDevices() || []; } catch(e){}
        const affected = devices.filter(d=>d.device_type===key);
        if (affected.length > 0) {
            const list = affected.map(d=>'<div style="margin:4px 0;"><b>'+d.name+'</b> ('+d.ip_address+')</div>').join('');
            const overlay=document.getElementById('modalOverlay'), box=document.getElementById('modalBox');
            box.innerHTML='<div class="modal-header"><h3>⚠ '+T('delete_blocked')+'</h3><button class="modal-close" onclick="App.closeModal()">&times;</button></div>'+
                '<div class="modal-body"><p>'+T('delete_type_hint')+'</p>'+list+'</div>'+
                '<div class="modal-footer"><button class="btn btn-primary" onclick="App.closeModal()">OK</button></div>';
            overlay.style.display='flex'; return;
        }
        if(!confirm(T('delete_confirm')))return;
        const d=this._deletedTypes(); d.push(key); this._set('nms_deleted_types',d);
        const types=this._get('nms_device_types',[]); this._set('nms_device_types',types.filter(t=>t.key!==key));
        const ov=this._get('nms_type_overrides',{}); delete ov[key]; this._set('nms_type_overrides',ov);
        this.render();
    },

};

// Global helper for all pages to get type/category options
window.TypeManager = {
    typeOptions: function(selected) {
        if (typeof DeviceTypesPage !== 'undefined' && DeviceTypesPage._allTypes) {
            return DeviceTypesPage._allTypes().map(function(t) {
                return '<option value="'+t.key+'"'+(t.key===selected?' selected':'')+'>'+
                    ((I18N&&I18N.lang==='zh')?t.zh:t.en)+'</option>';
            }).join('');
        }
        return '<option value="other">Other</option>';
    },
    catOptions: function(selected) {
        if (typeof DeviceTypesPage !== 'undefined' && DeviceTypesPage._allCats) {
            return DeviceTypesPage._allCats().map(function(c) {
                return '<option value="'+c.key+'"'+(c.key===selected?' selected':'')+'>'+
                    ((I18N&&I18N.lang==='zh')?c.zh:c.en)+'</option>';
            }).join('');
        }
        return '';
    },
};
