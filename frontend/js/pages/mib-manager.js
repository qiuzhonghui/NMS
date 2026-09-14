/**
 * MIB 管理页面 — 上传 MIB 文件、Cisco 支持列表，AI 分析 MIB 监控项。
 * 所有前端文本使用 I18N.t() 支持中英文切换。
 */
const MibManagerPage = {
    activeTab: 'mib',  // 'mib' | 'cisco'
    mibFiles: [],
    ciscoLists: [],

    async render() {
        document.getElementById('pageContainer').innerHTML = `
        <div class="page-header">
            <h2><i class="fas fa-database"></i> ${I18N.t('mib_mgmt')||'MIB Management'}</h2>
        </div>
        <div style="display:flex;gap:0;margin-bottom:16px;border-bottom:2px solid #e1e5eb;">
            <button class="tab-btn active" id="tabMib" onclick="MibManagerPage._switchTab('mib')">
                <i class="fas fa-file-code"></i> ${I18N.t('mib_files')||'MIB Files'}
            </button>
            <button class="tab-btn" id="tabCisco" onclick="MibManagerPage._switchTab('cisco')">
                <i class="fas fa-list-alt"></i> ${I18N.t('cisco_list')||'Cisco Support Lists'}
            </button>
        </div>
        <div id="mibPageContent"><div class="spinner"></div></div>`;

        // Tab button styles
        const style = document.createElement('style');
        style.textContent = `.tab-btn{padding:8px 20px;border:none;background:none;cursor:pointer;font-size:14px;color:#666;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;}.tab-btn.active{color:#4a6cf7;border-bottom-color:#4a6cf7;font-weight:600;}.tab-btn:hover{color:#4a6cf7;}`;
        document.head.appendChild(style);

        await this._loadTab('mib');
    },
    destroy() {},

    _switchTab(tab) {
        this.activeTab = tab;
        document.getElementById('tabMib').classList.toggle('active', tab === 'mib');
        document.getElementById('tabCisco').classList.toggle('active', tab === 'cisco');
        this._loadTab(tab);
    },

    async _loadTab(tab) {
        if (tab === 'mib') await this._renderMibTab();
        else await this._renderCiscoTab();
    },

    // ── MIB 文件标签页 ───────────────────────────────────────────────────

    async _renderMibTab() {
        try { this.mibFiles = await API.get('/mib-manager/mib-files?file_type=mib') || []; }
        catch(e) { this.mibFiles = []; }

        const container = document.getElementById('mibPageContent');
        container.innerHTML = `
        <div class="page-toolbar">
            <div class="page-toolbar-left">
                <button class="btn btn-primary" onclick="document.getElementById('mibUploadInput').click()">
                    <i class="fas fa-upload"></i> ${I18N.t('upload_mib')||'Upload MIB'}
                </button>
                <input type="file" id="mibUploadInput" accept=".mib,.my,.txt" style="display:none;" onchange="MibManagerPage._uploadMib(this)">
            </div>
        </div>
        ${this.mibFiles.length === 0
            ? `<div class="empty-state"><p>${I18N.t('no_mib_files')||'No MIB files uploaded'}</p>
               <small>${I18N.t('mib_upload_hint')||'Upload .mib or .my files to parse OIDs'}</small></div>`
            : `<div class="card-list">
                ${this.mibFiles.map(f => `
                <div class="card" style="margin-bottom:10px;padding:14px 18px;cursor:pointer;" onclick="MibManagerPage._viewMibDetail('${f.id}','${this._escJs(f.filename)}')">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <div style="flex:1;min-width:0;">
                            <div style="display:flex;align-items:center;gap:8px;">
                                <i class="fas fa-file-code" style="color:#4a6cf7;"></i>
                                <strong style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${Format.esc(f.filename)}</strong>
                                <i class="fas fa-chevron-right" style="color:#999;font-size:10px;"></i>
                            </div>
                            <div style="margin-top:4px;font-size:12px;color:#999;">
                                <span>${f.oid_count||0} OIDs</span>
                                <span style="margin-left:12px;">${f.created_at ? new Date(f.created_at).toLocaleString() : ''}</span>
                            </div>
                        </div>
                        <div style="display:flex;gap:6px;flex-shrink:0;" onclick="event.stopPropagation();">
                            <button class="btn btn-sm btn-primary" onclick="MibManagerPage._aiAnalyze('${f.id}','${this._escJs(f.filename)}')" style="font-size:11px;">
                                <i class="fas fa-robot"></i> ${I18N.t('ai_analyze')||'AI Analyze'}
                            </button>
                            <button class="btn btn-sm btn-danger" onclick="MibManagerPage._deleteMib('${f.id}')">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>`).join('')}
            </div>`}`;
    },

    // ── Cisco 支持列表标签页 ──────────────────────────────────────────────

    async _renderCiscoTab() {
        try { this.ciscoLists = await API.get('/mib-manager/mib-files?file_type=cisco_list') || []; }
        catch(e) { this.ciscoLists = []; }

        const container = document.getElementById('mibPageContent');
        container.innerHTML = `
        <div class="page-toolbar">
            <div class="page-toolbar-left">
                <button class="btn btn-primary" onclick="document.getElementById('ciscoUploadInput').click()">
                    <i class="fas fa-upload"></i> ${I18N.t('upload_cisco_list')||'Upload Cisco List'}
                </button>
                <input type="file" id="ciscoUploadInput" accept=".html,.htm" style="display:none;" onchange="MibManagerPage._uploadCiscoList(this)">
            </div>
        </div>
        ${this.ciscoLists.length === 0
            ? `<div class="empty-state"><p>${I18N.t('no_cisco_lists')||'No Cisco support lists uploaded'}</p>
               <small>${I18N.t('cisco_upload_hint')||'Upload Cisco MIB support list HTML files'}</small></div>`
            : `<div class="card-list">
                ${this.ciscoLists.map(f => `
                <div class="card" style="margin-bottom:10px;padding:14px 18px;cursor:pointer;" onclick="MibManagerPage._viewCiscoDetail('${f.id}','${this._escJs(f.filename)}')">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <div style="flex:1;min-width:0;">
                            <div style="display:flex;align-items:center;gap:8px;">
                                <i class="fas fa-list-alt" style="color:#e67e22;"></i>
                                <strong style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${Format.esc(f.filename)}</strong>
                                <i class="fas fa-chevron-right" style="color:#999;font-size:10px;"></i>
                            </div>
                            <div style="margin-top:4px;font-size:12px;color:#999;">
                                <span>${f.mib_count||0} MIBs</span>
                                <span style="margin-left:12px;">${f.oid_count||0} OIDs</span>
                                <span style="margin-left:12px;">${f.created_at ? new Date(f.created_at).toLocaleString() : ''}</span>
                            </div>
                        </div>
                        <div style="display:flex;gap:6px;flex-shrink:0;" onclick="event.stopPropagation();">
                            <button class="btn btn-sm btn-success" onclick="event.stopPropagation();MibManagerPage._bgTestAll('${f.id}')" style="font-size:11px;" title="Background test without opening detail modal">
                                <i class="fas fa-flask"></i> Test
                            </button>
                            <button class="btn btn-sm" onclick="MibManagerPage._reparseCisco('${f.id}','${this._escJs(f.filename)}')" style="font-size:11px;" title="${I18N.t('reparse_cisco')||'Re-download MIBs from this list'}">
                                <i class="fas fa-sync-alt"></i> ${I18N.t('re_analyze')||'Re-analyze'}
                            </button>
                            <button class="btn btn-sm btn-primary" onclick="MibManagerPage._aiAnalyze('${f.id}','${this._escJs(f.filename)}')" style="font-size:11px;">
                                <i class="fas fa-robot"></i> ${I18N.t('ai_analyze')||'AI Analyze'}
                            </button>
                            <button class="btn btn-sm btn-danger" onclick="MibManagerPage._deleteMib('${f.id}')">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>`).join('')}
            </div>`}`;
    },

    // ── 上传 MIB 文件 ────────────────────────────────────────────────────

    async _uploadMib(input) {
        const file = input.files[0]; if (!file) return;
        App.toast((I18N.t('uploading_file')||'Uploading') + ': ' + file.name, 'info');
        const form = new FormData(); form.append('file', file);
        try {
            const data = await API.upload('/mib-manager/upload-mib', form);
            App.toast(`${data.oid_count||0} OIDs parsed from ${data.filename}`, 'success');
            this._loadTab('mib');
        } catch(e) {
            App.toast((I18N.t('upload_failed')||'Upload failed') + ': ' + e.message, 'danger');
        }
        input.value = '';
    },

    // ── 上传 Cisco 支持列表（流式进度） ─────────────────────────────────────

    async _uploadCiscoList(input) {
        const file = input.files[0]; if (!file) return;

        // 显示进度窗口
        const overlay = document.getElementById('modalOverlay');
        const box = document.getElementById('modalBox');
        box.innerHTML = `<div class="modal-header"><h3><i class="fas fa-circle-notch fa-spin"></i> ${I18N.t('upload_cisco_list')||'Upload Cisco List'}</h3>
            <button class="modal-close" onclick="App.closeModal()">&times;</button></div>
            <div class="modal-body">
                <div id="ciscoLog" style="background:#1a1a2e;color:#0f0;font-family:monospace;font-size:11px;padding:10px;border-radius:6px;height:300px;overflow-y:auto;white-space:pre-wrap;line-height:1.4;"></div>
            </div>
            <div class="modal-footer">
                <span id="ciscoElapsed" style="color:#999;font-size:12px;"></span>
                <span id="ciscoStats" style="color:#999;font-size:12px;margin-right:auto;"></span>
                <button class="btn" onclick="App.closeModal()">${I18N.t('cancel')}</button>
            </div>`;
        overlay.style.display = 'flex';

        const startTime = Date.now();
        const elapsedTimer = setInterval(() => {
            const el = document.getElementById('ciscoElapsed');
            if (el) el.textContent = `Elapsed: ${Math.floor((Date.now()-startTime)/1000)}s`;
        }, 500);

        const log = (msg) => {
            const el = document.getElementById('ciscoLog');
            if (el) { el.textContent += msg + '\n'; el.scrollTop = el.scrollHeight; }
        };
        log(`[${new Date().toLocaleTimeString()}] ${I18N.t('uploading_file')||'Uploading'}: ${file.name}`);

        const form = new FormData(); form.append('file', file);
        try {
            const res = await fetch('/api/mib-manager/upload-cisco-list', {method:'POST',body:form});
            if (!res.ok) { log(`[ERROR] HTTP ${res.status}`); return; }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
                const {done, value} = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, {stream:true});
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const l of lines) {
                    if (l.trim()) {
                        try {
                            const d = JSON.parse(l.trim());
                            if (d.log) log(`[${new Date().toLocaleTimeString()}] ${d.log}`);
                            if (d.stat) document.getElementById('ciscoStats').textContent = d.stat;
                            if (d.done) {
                                clearInterval(elapsedTimer);
                                log(`\n[DONE] ${d.stat}`);
                                setTimeout(() => { App.closeModal(); MibManagerPage._loadTab('cisco'); App.toast(d.stat, 'success'); }, 1000);
                            }
                        } catch(e) {}
                    }
                }
            }
        } catch(e) { log(`[ERROR] ${e.message}`); }
        clearInterval(elapsedTimer);
        input.value = '';
    },

    // ── AI 分析 MIB 文件（流式进度） ─────────────────────────────────────

    async _aiAnalyze(fileId, filename) {
        const overlay = document.getElementById('modalOverlay');
        const box = document.getElementById('modalBox');
        box.innerHTML = `<div class="modal-header"><h3><i class="fas fa-robot"></i> ${I18N.t('ai_analyze')||'AI Analyze'}: ${Format.esc(filename)}</h3>
            <button class="modal-close" onclick="App.closeModal()">&times;</button></div>
            <div class="modal-body">
                <div style="margin-bottom:8px;display:flex;align-items:center;gap:12px;">
                    <span id="aiStats" style="color:#999;font-size:12px;margin-right:auto;"></span>
                    <span id="aiElapsed" style="color:#999;font-size:12px;"></span>
                </div>
                <div id="aiWinGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px;margin-bottom:10px;"></div>
                <div id="aiResults" style="margin-top:12px;max-height:200px;overflow-y:auto;display:none;"></div>
            </div>
            <div class="modal-footer">
                <button class="btn" onclick="App.closeModal()">${I18N.t('cancel')}</button>
            </div>`;
        overlay.style.display = 'flex';

        const startTime = Date.now();
        const elapsedTimer = setInterval(() => {
            const el = document.getElementById('aiElapsed');
            if (el) el.textContent = 'Elapsed: ' + Math.floor((Date.now()-startTime)/1000) + 's';
        }, 500);

        // Per-window mini logs
        const winColors = ['#4a6cf7','#e67e22','#27ae60','#e74c3c','#9b59b6','#1abc9c','#f39c12','#3498db','#2ecc71','#e91e63'];
        const winLogs = {}; // winId -> html string
        const MAX_WIN_LINES = 8;

        const winLog = (winId, msg, color) => {
            if (!winId) return;
            if (!winLogs[winId]) winLogs[winId] = [];
            const c = color || winColors[(winId-1) % winColors.length];
            winLogs[winId].push(`<span style="color:${c}">${msg}</span>`);
            if (winLogs[winId].length > MAX_WIN_LINES) winLogs[winId].shift();
            _renderWinPanels();
        };

        const _renderWinPanels = () => {
            const grid = document.getElementById('aiWinGrid');
            if (!grid) return;
            let html = '';
            const sorted = Object.keys(winLogs).sort((a,b)=>a-b);
            for (const wid of sorted) {
                const c = winColors[(wid-1) % winColors.length];
                const lines = winLogs[wid].join('<br>');
                html += `<div style="background:#1a1a2e;border:1px solid ${c};border-radius:4px;padding:4px 6px;font-family:monospace;font-size:10px;line-height:1.3;min-height:40px;">
                    <div style="color:${c};font-weight:bold;margin-bottom:2px;">窗口${wid}</div>
                    <div style="color:#aaa;">${lines || '<span style="color:#555">等待中...</span>'}</div>
                </div>`;
            }
            grid.innerHTML = html;
        };

        // Shared log function for non-window messages
        const sharedLog = (msg) => {
            const el = document.getElementById('aiResults');
            if (el) {
                el.style.display = '';
                el.innerHTML += `<div style="font-size:11px;color:#aaa;padding:1px 0;">${msg}</div>`;
                el.scrollTop = el.scrollHeight;
            }
        };
        sharedLog(`开始 AI 分析: ${filename}`);

        try {
            const res = await fetch('/api/mib-manager/analyze-mib/' + fileId, { method: 'POST' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: 'HTTP ' + res.status }));
                throw new Error(err.detail || 'HTTP ' + res.status);
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let finalResults = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const l of lines) {
                    if (!l.trim()) continue;
                    try {
                        const d = JSON.parse(l.trim());
                        // Per-window log messages
                        if (d.slot && d.log) {
                            const statusIcon = d.status === 'done' ? '✓' : d.status === 'error' ? '✗' : d.status === 'warn' ? '⚠' : '';
                            winLog(d.slot, `${statusIcon} ${d.log.replace(/^\[窗口\d+\]\s*/, '')}`, null);
                        } else if (d.heartbeat && d.log) {
                            document.getElementById('aiStats').textContent = d.log.replace(/^\.\.\. /,'');
                        } else if (d.log) {
                            sharedLog(`[${new Date().toLocaleTimeString()}] ${d.log}`);
                        }
                        if (d.stat) document.getElementById('aiStats').textContent = d.stat;
                        if (d.done) {
                            clearInterval(elapsedTimer);
                            finalResults = d;
                            sharedLog(`[DONE] ${d.stat}`);
                        }
                    } catch(e) {}
                }
            }
            clearInterval(elapsedTimer);

            // 显示分析结果
            if (finalResults && finalResults.results && finalResults.results.length > 0) {
                const isZh = (I18N.lang || 'zh') === 'zh';
                const resultsDiv = document.getElementById('aiResults');
                resultsDiv.style.display = '';
                let html = `<h4 style="margin-bottom:8px;"><i class="fas fa-check-circle" style="color:#27ae60;"></i> ${I18N.t('ai_analyze_done')||'Analysis Complete'} — ${finalResults.analyzed||0} OIDs</h4>`;
                for (const r of finalResults.results) {
                    const desc = isZh ? (r.description_zh || '') : (r.description_en || '');
                    html += `<div style="padding:6px 8px;border-bottom:1px solid #e1e5eb;font-size:12px;">
                        <div><code style="font-size:10px;">${Format.esc(r.oid||'')}</code> <strong>${Format.esc(r.name||'')}</strong></div>
                        <div style="color:#666;">${Format.esc(desc)}</div>
                        <div style="color:#999;margin-top:2px;font-size:10px;">
                            ${I18N.t('unit')||'Unit'}: ${Format.esc(r.suggested_unit||'-')}
                            · ${I18N.t('display')||'Display'}: ${Format.esc(r.suggested_display||'chart')}
                            · <span class="status-badge ${r.importance==='high'?'offline':r.importance==='medium'?'warning':'online'}">${r.importance||'medium'}</span>
                        </div>
                    </div>`;
                }
                resultsDiv.innerHTML = html;
            } else if (!finalResults) {
                sharedLog(`WARNING: AI 未返回有效结果`);
            }

            const footer = box.querySelector('.modal-footer');
            const cancelBtn = footer.querySelector('.btn');
            if (cancelBtn) {
                cancelBtn.textContent = I18N.t('close') || 'Close';
                cancelBtn.onclick = () => App.closeModal();
            }

            this._loadTab(this.activeTab);
        } catch (e) {
            clearInterval(elapsedTimer);
            sharedLog(`ERROR: ${e.message}`);
            sharedLog(I18N.t('ai_config_hint')||'Please configure AI settings first');
            const footer = box.querySelector('.modal-footer');
            const cancelBtn = footer.querySelector('.btn');
            if (cancelBtn) {
                cancelBtn.textContent = I18N.t('close') || 'Close';
                cancelBtn.onclick = () => App.closeModal();
            }
        }
    },

    // ── 查看 MIB/Cisco 详情（含 OID 列表 + ParsedOid 描述） ──────────
    // 后端 get_mib_file 现在已包含 ParsedOid 描述，前端直接使用

    _renderOidDetailModal(filename, oids, icon, fileId) {
        const isZh = (I18N.lang||'zh')==='zh';
        const uniqueSources = [...new Set(oids.map(o=>o.mib_source||'').filter(Boolean))].sort();

        // Build source filter options
        const srcOpts = uniqueSources.map(s => `<option value="${Format.esc(s)}">${Format.esc(s)}</option>`).join('');

        const html = `
        <div style="margin-bottom:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <input type="text" id="oidModalSearch" class="form-input" placeholder="${I18N.t('search_oid')||'Search...'}" style="flex:1;min-width:120px;" oninput="MibManagerPage._filterOidModal()">
            <select id="oidModalSource" class="form-input" style="width:160px;" onchange="MibManagerPage._filterOidModal()">
                <option value="">${I18N.t('all_sources')||'All MIBs'} (${oids.length})</option>
                ${srcOpts}
            </select>
            <select id="oidModalResult" class="form-input" style="width:130px;" onchange="MibManagerPage._filterOidModal()">
                <option value="">${I18N.t('all_results')||'All Results'}</option>
                <option value="ERROR">${I18N.t('errors_only')||'Errors Only'}</option>
                <option value="OK">${I18N.t('success_only')||'Success Only'}</option>
            </select>
            <button class="btn btn-sm" onclick="MibManagerPage._exportOids()" title="${I18N.t('export_csv')||'Export CSV'}">
                <i class="fas fa-download"></i> ${I18N.t('export')||'Export'}
            </button>
            <button class="btn btn-sm" id="oidDiffBtn" onclick="MibManagerPage._toggleDiff()" title="${I18N.t('compare_results')||'Compare'}">
                <i class="fas fa-code-branch"></i> ${I18N.t('compare_results')||'Diff'}
            </button>
        </div>
        <div id="oidModalCount" style="margin-bottom:6px;color:#999;font-size:11px;flex-shrink:0;">${oids.length} OIDs</div>
        <div id="oidScrollContainer" style="flex:1;overflow-y:auto;border:1px solid #e1e5eb;border-radius:6px;min-height:0;position:relative;">
        <table class="data-table" id="oidModalTable" style="width:100%;table-layout:fixed;">
            <thead><tr>
                <th style="width:35px;">#</th>
                <th style="width:25%;">${I18N.t('description')||'Description'}</th>
                <th style="width:18%;">${I18N.t('oid_name')||'OID Name'}</th>
                <th style="width:30%;">OID</th>
                <th style="width:15%;">${I18N.t('mib_source')||'MIB Source'}</th>
                <th style="width:44px;">${I18N.t('test')||'Test'}</th>
                <th style="width:100px;" id="oidPrevHeader">${I18N.t('prev_result')||'Prev'}</th>
                <th style="width:100px;">${I18N.t('curr_result')||'Current'}</th>
            </tr></thead>
            <tbody id="oidModalBody">`;

        // Inject modal HTML
        const overlay = document.getElementById('modalOverlay');
        const box = document.getElementById('modalBox');
        const savedPct = localStorage.getItem('nms_modal_pct') || '90';
        const sizeSlider = '<div style="display:flex;align-items:center;gap:4px;margin-right:24px;"><button class="btn btn-sm modal-size-minus" style="padding:2px 5px;font-size:10px;line-height:1;">−</button><input type="range" class="modal-size-slider" min="30" max="90" value="'+savedPct+'" style="width:80px;accent-color:#4a6cf7;"><button class="btn btn-sm modal-size-plus" style="padding:2px 5px;font-size:10px;line-height:1;">+</button></div>';
        const cfgBtn = '<button class="btn btn-sm" style="margin-right:auto;" onclick="MibManagerPage._showSnmpConfig()"><i class="fas fa-cog"></i> '+(I18N.t('config_test')||'Config Test')+'</button>';
        const testAllBtn = '<button class="btn btn-sm btn-primary" id="oidTestAllBtn" onclick="MibManagerPage._testAllOids()"><i class="fas fa-play"></i> '+(I18N.t('test_all')||'Test All')+'</button>';
        const aiBtn = fileId ? '<button class="btn btn-sm" onclick="MibManagerPage._aiAnalyze(\x27'+fileId+'\x27,\x27'+this._escJs(filename)+'\x27)"><i class="fas fa-robot"></i> AI</button>' : '';
        box.innerHTML = '<div class="modal-header"><h3><i class="fas '+icon+'"></i> '+Format.esc(filename)+'</h3>'+sizeSlider+'<button class="modal-close" onclick="App.closeModal()">&times;</button></div><div class="modal-body" style="height:60vh;min-height:60vh;max-height:60vh;overflow:hidden;display:flex;flex-direction:column;">'+html+'</tbody></table></div><div id="oidTestProgress" style="display:none;align-items:center;gap:10px;padding:6px 0;flex-shrink:0;"><div style="flex:1;height:6px;background:#e1e5eb;border-radius:3px;overflow:hidden;"><div id="oidTestBar" style="height:100%;width:0%;background:#4a6cf7;transition:width 0.3s;border-radius:3px;"></div></div><span id="oidTestStats" style="color:#4a6cf7;font-size:11px;white-space:nowrap;font-weight:600;"></span></div></div><div class="modal-footer">'+cfgBtn+testAllBtn+aiBtn+'<button class="btn" onclick="App.closeModal()">'+(I18N.t('close')||'Close')+'</button></div>';
        overlay.style.display = 'flex';
        const slider = box.querySelector('.modal-size-slider');
        const applySize = (pct) => { box.style.width = pct + 'vw'; box.style.maxWidth = pct + 'vw'; slider.value = pct; localStorage.setItem('nms_modal_pct', pct); };
        slider.addEventListener('input', () => applySize(slider.value));
        box.querySelector('.modal-size-minus').addEventListener('click', (e) => { e.stopPropagation(); applySize(Math.max(30, parseInt(slider.value) - 5)); });
        box.querySelector('.modal-size-plus').addEventListener('click', (e) => { e.stopPropagation(); applySize(Math.min(90, parseInt(slider.value) + 5)); });
        applySize(savedPct);
        this._oidModalData = oids;
        this._oidModalFilename = filename;
        setTimeout(async () => {
            try {
                const s = await API.get('/snmp-templates/test-results/status');
                const hdr = document.getElementById('oidPrevHeader');
                if (hdr && s.finished_at) { const d = new Date(s.finished_at + 'Z'); hdr.textContent = (I18N.t('prev_result')||'Prev') + ' ' + d.toLocaleString(); }
            } catch(e) {}
        }, 200);
        setTimeout(async () => {
            try {
                const dbResults = await API.get('/snmp-templates/test-results/load');
                const tb = document.getElementById('oidModalBody');
                if (tb) tb.style.display = 'none';
                document.querySelectorAll('.oid-prev-load').forEach(el => {
                    const oid = el.dataset.oid; const r = dbResults[oid];
                    if (r && r.v) { el.textContent = r.v.substring(0, 20); el.title = r.v; el.style.color = '#888'; }
                });
                if (tb) tb.style.display = '';
            } catch(e) {}
        }, 500);

        // Render all rows with content-visibility:auto (browser skips off-screen rendering)
        const renderOneRow = (o, idx) => {
            const desc = isZh ? (o.desc_zh||o.desc_en||'') : (o.desc_en||o.desc_zh||'');
            const src = o.mib_source || '';
            return `<tr data-search="${Format.esc((o.name+' '+o.oid+' '+desc+' '+src).toLowerCase())}" data-source="${Format.esc(src)}" data-oid="${Format.esc(o.oid)}" data-name="${Format.esc(o.name||'')}" style="content-visibility:auto;contain-intrinsic-size:auto 26px;">
                <td style="color:#999;font-size:10px;">${idx+1}</td>
                <td style="font-size:11px;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${Format.esc(desc)}">${Format.esc(desc||'-')}</td>
                <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;" title="${Format.esc(o.name||'')}">${Format.esc(o.name||'')}</td>
                <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><code style="font-size:10px;">${Format.esc(o.oid||'')}</code></td>
                <td style="font-size:10px;color:#999;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${Format.esc(src)}">${Format.esc(src)}</td>
                <td style="text-align:center;"><button class="btn btn-sm oid-test-btn" onclick="event.stopPropagation();MibManagerPage._testOidRow(this,'${this._escJs(o.oid)}','${this._escJs(o.name||'')}')" style="font-size:10px;padding:2px 5px;" title="${I18N.t('test')||'Test'}"><i class="fas fa-flask"></i></button></td>
                <td class="oid-prev-cell" style="font-size:10px;"><span class="oid-prev-load" data-oid="${Format.esc(o.oid||'')}" style="color:#ccc;">-</span></td>
                <td class="oid-curr-cell" style="font-size:10px;color:#999;">-</td>
            </tr>`;
        };

        // Build all rows at once (content-visibility:auto = fast, only visible rows rendered)
        let rowsHtml = '';
        for (let i = 0; i < oids.length; i++) {
            rowsHtml += renderOneRow(oids[i], i);
        }
        const tbody = document.getElementById('oidModalBody');
        tbody.innerHTML = rowsHtml;
    },

    _saveColWidths(table) {
        const widths = {};
        table.querySelectorAll('th').forEach((th, i) => {
            if (th.style.width) widths[i] = th.style.width;
        });
        localStorage.setItem('nms_oid_col_widths', JSON.stringify(widths));
    },

    _restoreColWidths(table) {
        try {
            const widths = JSON.parse(localStorage.getItem('nms_oid_col_widths') || '{}');
            table.querySelectorAll('th').forEach((th, i) => {
                if (widths[i]) { th.style.width = widths[i]; th.style.minWidth = widths[i]; }
            });
        } catch(e) {}
    },

    _showSnmpConfig() {
        const saved = JSON.parse(localStorage.getItem('nms_snmp_test_cfg')||'{"ip":"","port":161,"community":"public","version":"2c"}');
        const concurrency = localStorage.getItem('nms_test_concurrency') || '6';
        const retries = localStorage.getItem('nms_test_retries') || '1';
        let panel = document.getElementById('snmpCfgPanel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'snmpCfgPanel';
            panel.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10002;background:#fff;border:1px solid #4a6cf7;border-radius:8px;padding:20px;width:360px;box-shadow:0 8px 30px rgba(0,0,0,0.25);';
            document.body.appendChild(panel);
        }
        panel.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><strong><i class="fas fa-cog"></i> ${I18N.t('config_test')||'SNMP Test Config'}</strong><button onclick="document.getElementById('snmpCfgPanel').remove()" style="border:none;background:none;cursor:pointer;font-size:18px;">&times;</button></div>
            <div style="margin-bottom:8px;"><label style="font-size:11px;">${I18N.t('ip_address')||'IP'}</label><input type="text" id="snmptIP" class="form-input" value="${Format.esc(saved.ip||'')}" style="font-size:12px;"></div>
            <div style="display:flex;gap:8px;margin-bottom:8px;"><div style="flex:1;"><label style="font-size:11px;">${I18N.t('snmp_port')||'Port'}</label><input type="number" id="snmptPort" class="form-input" value="${saved.port||161}" style="font-size:12px;"></div><div style="flex:1;"><label style="font-size:11px;">${I18N.t('snmp_version')||'Version'}</label><select id="snmptVer" class="form-input" style="font-size:12px;"><option value="1" ${saved.version==='1'?'selected':''}>v1</option><option value="2c" ${saved.version==='2c'?'selected':''}>v2c</option></select></div></div>
            <div style="margin-bottom:8px;"><label style="font-size:11px;">${I18N.t('snmp_community')||'Community'}</label><input type="text" id="snmptComm" class="form-input" value="${Format.esc(saved.community||'public')}" style="font-size:12px;"></div>
            <div style="display:flex;gap:8px;margin-bottom:12px;"><div style="flex:1;"><label style="font-size:11px;">${I18N.t('test_concurrency')||'Concurrency'}</label><input type="number" id="snmptConc" class="form-input" value="${concurrency}" min="1" max="8" style="font-size:12px;"></div><div style="flex:1;"><label style="font-size:11px;">${I18N.t('test_retries')||'Retries'}</label><input type="number" id="snmptRetry" class="form-input" value="${retries}" min="0" max="5" style="font-size:12px;"></div></div>
            <button class="btn btn-primary btn-sm" style="width:100%;" onclick="MibManagerPage._saveSnmpCfg()">${I18N.t('save')||'Save'}</button>`;
    },

    _saveSnmpCfg() {
        const cfg = {ip:document.getElementById('snmptIP').value.trim(),port:parseInt(document.getElementById('snmptPort').value)||161,community:document.getElementById('snmptComm').value.trim()||'public',version:document.getElementById('snmptVer').value};
        localStorage.setItem('nms_snmp_test_cfg', JSON.stringify(cfg));
        localStorage.setItem('nms_test_concurrency', document.getElementById('snmptConc').value || '3');
        localStorage.setItem('nms_test_retries', document.getElementById('snmptRetry').value || '1');
        const p = document.getElementById('snmpCfgPanel'); if(p) p.remove();
        App.toast(I18N.t('settings_saved')||'Saved','success');
    },

    async _testOidRow(btn, oid, name) {
        const row = btn.closest('tr');
        const cell = row ? row.querySelector('.oid-curr-cell') : null;
        if (cell) { cell.innerHTML = '<span style="color:#f39c12;">...</span>'; }
        await this._doTestOne(oid, name, cell);
    },

    async _doTestOne(oid, name, cell) {
        const cfg = JSON.parse(localStorage.getItem('nms_snmp_test_cfg')||'{}');
        if (!cfg.ip) return;
        try {
            const res = await API.post('/snmp-templates/test-oid', {oid, name, ip:cfg.ip, port:cfg.port, community:cfg.community, version:cfg.version});
            const val = res.value !== undefined ? res.value : 'No value';
            const short = String(val).substring(0, 35);
            if (cell) { cell.innerHTML = `<span style="color:#27ae60;" title="${Format.esc(String(val))}">${Format.esc(short)}</span>`; cell.dataset.result = String(val); }
            // 保存到数据库
            try { await API.post('/snmp-templates/test-results/save', {results: [{oid, name, value: String(val), ip: cfg.ip}]}); } catch(e) {}
        } catch(e) {
            const errMsg = (e.message||'Unknown error');
            const short = errMsg.substring(0, 40);
            if (cell) { cell.innerHTML = `<span style="color:#e74c3c;" title="${Format.esc(errMsg)}">${Format.esc(short)}</span>`; cell.dataset.result = errMsg; }
            try { await API.post('/snmp-templates/test-results/save', {results: [{oid, name, value: errMsg, ip: cfg.ip}]}); } catch(e) {}
        }
    },

    _testAbortController: null,

    async _testAllOids() {
        // 如果正在测试，则停止
        if (this._testAbortController) {
            this._testAbortController.abort();
            this._testAbortController = null;
            document.getElementById('oidTestProgress').style.display = 'none';
            const btn = document.querySelector('#modalBox .modal-footer .btn-primary');
            if (btn) { btn.innerHTML = '<i class="fas fa-play"></i> '+(I18N.t('test_all')||'Test All'); btn.classList.remove('btn-danger'); }
            App.toast('Test stopped', 'warning');
            return;
        }

        try {
        const cfgStr = localStorage.getItem('nms_snmp_test_cfg');
        if (!cfgStr) { this._showSnmpConfig(); App.toast(I18N.t('config_test_first')||'Configure first','warning'); return; }
        const cfg = JSON.parse(cfgStr);
        if (!cfg || !cfg.ip) { this._showSnmpConfig(); App.toast(I18N.t('config_test_first')||'Configure first','warning'); return; }
        const allData = this._oidModalData;
        if (!allData || !Array.isArray(allData) || allData.length === 0) { App.toast('No OIDs to test','warning'); return; }
        const total = allData.length;
        const concurrency = parseInt(localStorage.getItem('nms_test_concurrency')||'30');

        // UI: 停止按钮
        document.getElementById('oidTestProgress').style.display = 'none'; // 暂时隐藏进度条排查卡死
        const btn = document.getElementById('oidTestAllBtn');
        if (btn) { btn.innerHTML = '<i class="fas fa-stop"></i> '+(I18N.t('stop_test')||'Stop'); btn.classList.add('btn-danger'); }

        // 启动后台测试（立即返回）
        const startRes = await API.post('/snmp-templates/batch-test-oid', {oids: [], ip: cfg.ip, port: cfg.port, community: cfg.community, version: cfg.version, concurrency});
        if (startRes.status === 'error') { App.toast(startRes.message, 'danger'); return; }
        // 显示进度条
        document.getElementById('oidTestProgress').style.display = 'flex';
        document.getElementById('oidTestBar').style.width = '0%';
        // 轮询进度（零DOM操作排查卡死）
        const poll = async () => {
            try {
                const s = await API.get('/snmp-templates/test-results/status');
                if (s.running) setTimeout(poll, 3000);
                else App.toast(`Test complete: ${s.total} OIDs`, 'success');
            } catch(e) { setTimeout(poll, 5000); }
        };
        setTimeout(poll, 1000);
        } catch(e) {
            if (e.name === 'AbortError') { /* user stopped */ }
            else { App.toast('Test error: '+e.message, 'danger'); console.error(e); }
        }
        // Cleanup
        this._testAbortController = null;
        document.getElementById('oidTestProgress').style.display = 'none';
        const btn2 = document.getElementById('oidTestAllBtn');
        if (btn2) { btn2.innerHTML = '<i class="fas fa-play"></i> '+(I18N.t('test_all')||'Test All'); btn2.classList.remove('btn-danger'); }
        this._updateResultFilter();
    },

    _bgPollTimer: null,
    _bgToastId: null,

    async _bgTestAll(fileId) {
        try {
        const cfgStr = localStorage.getItem('nms_snmp_test_cfg');
        if (!cfgStr) { this._showSnmpConfig(); App.toast('Configure SNMP settings first', 'warning'); return; }
        const cfg = JSON.parse(cfgStr);
        if (!cfg || !cfg.ip) { this._showSnmpConfig(); App.toast('Configure SNMP settings first', 'warning'); return; }
        const concurrency = parseInt(localStorage.getItem('nms_test_concurrency')||'30');
        App.toast(`Starting test with ${cfg.ip}...`, 'info', 2000);
        const res = await API.post('/snmp-templates/batch-test-oid', {oids:[], ip:cfg.ip, port:cfg.port, community:cfg.community, version:cfg.version, concurrency, file_id: fileId});
        if (res.status === 'error') { App.toast(res.message||'Test start failed', 'danger'); return; }
        if (this._bgPollTimer) clearInterval(this._bgPollTimer);
        this._bgPollTimer = setInterval(async () => {
            try {
                const s = await API.get('/snmp-templates/test-results/status');
                if (s.total > 0) {
                    const pct = Math.round(s.done * 100 / s.total);
                    let t = document.getElementById('bgTestToast');
                    if (!t) {
                        t = document.createElement('div');
                        t.id = 'bgTestToast';
                        t.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99999;padding:14px 20px;background:#1a1a2e;color:#0f0;border:1px solid #4a6cf7;border-radius:8px;font-family:monospace;font-size:13px;box-shadow:0 4px 20px rgba(0,0,0,0.3);min-width:280px;';
                        const started = s.started_at ? new Date(s.started_at + 'Z').toLocaleTimeString() : '';
                        t.innerHTML = `<div style="margin-bottom:2px;font-size:11px;color:#888;">SNMP Test ${started}</div><div id="bgTestProg" style="font-size:18px;font-weight:bold;">-</div><div style="background:#333;height:6px;margin-top:8px;border-radius:3px;overflow:hidden;"><div id="bgTestBar" style="background:#4a6cf7;height:100%;width:0%;border-radius:3px;transition:width 0.5s;"></div></div>`;
                        document.body.appendChild(t);
                    }
                    document.getElementById('bgTestProg').textContent = `${s.done}/${s.total} (${pct}%)`;
                    document.getElementById('bgTestBar').style.width = pct + '%';
                }
                if (!s.running) {
                    clearInterval(this._bgPollTimer);
                    const t = document.getElementById('bgTestToast');
                    if (t) setTimeout(() => t.remove(), 3000);
                    App.toast(`SNMP test done: ${s.total} OIDs. Open detail to view.`, 'success', 5000);
                    this._loadTab('cisco');
                }
            } catch(e) {}
        }, 2000);
        } catch(e) { App.toast('Error: '+e.message, 'danger'); }
    },

    _diffMode: false,

    _toggleDiff() {
        this._diffMode = !this._diffMode;
        const btn = document.getElementById('oidDiffBtn');
        if (this._diffMode) {
            if (btn) { btn.classList.add('btn-primary'); btn.textContent = 'Showing Diff'; }
            document.querySelectorAll('#oidModalBody tr').forEach(row => {
                const prev = row.querySelector('.oid-prev-cell')?.dataset?.result || row.querySelector('.oid-prev-cell')?.textContent?.trim() || '';
                const curr = row.querySelector('.oid-curr-cell')?.dataset?.result || '';
                if (prev === curr || !curr) row.style.display = 'none';
                else row.style.display = '';
            });
        } else {
            if (btn) { btn.classList.remove('btn-primary'); btn.innerHTML = '<i class="fas fa-code-branch"></i> '+(I18N.t('compare_results')||'Diff'); }
            this._filterOidModal(); // restore normal filter
        }
    },

    async _updateResultFilter() {
        const sel = document.getElementById('oidModalResult');
        if (!sel) return;
        const currentVal = sel.value;
        try {
            const dbResults = await API.get('/snmp-templates/test-results/load');
            const values = new Map();
            for (const [oid, r] of Object.entries(dbResults || {})) {
                const v = (r.v || '').trim();
                if (v) values.set(v, (values.get(v)||0) + 1);
            }
            sel.innerHTML = '<option value="">'+(I18N.t('all_results')||'All')+'</option>';
            sel.innerHTML += '<option value="ok">'+(I18N.t('success_only')||'Success')+'</option>';
            sel.innerHTML += '<option value="err">'+(I18N.t('errors_only')||'Errors')+'</option>';
            const sorted = [...values.entries()].sort((a,b) => b[1] - a[1]);
            for (const [v, count] of sorted.slice(0, 100)) {
                const label = v.substring(0, 50);
                sel.innerHTML += `<option value="${Format.esc(v)}">${Format.esc(label)} (${count})</option>`;
            }
            sel.value = currentVal;
        } catch(e) {}
    },

    async _testOid(oid, name) {
        const cfg = JSON.parse(localStorage.getItem('nms_snmp_test_cfg')||'{}');
        if (!cfg.ip) { this._showSnmpConfig(); App.toast(I18N.t('config_test_first')||'Configure first','warning'); return; }
        // 更新行内单元格
        const row = document.querySelector(`#oidModalBody tr[data-oid="${Format.esc(oid)}"]`);
        const cell = row ? row.querySelector('.oid-curr-cell') : null;
        if (cell) { cell.innerHTML = '<span style="color:#f39c12;">...</span>'; }

        const oidData = this._oidModalData?.find(o => o.oid === oid);
        const isZh = (I18N.lang||'zh')==='zh';
        const desc = oidData ? (isZh ? (oidData.desc_zh||oidData.desc_en||'') : (oidData.desc_en||oidData.desc_zh||'')) : '';

        const box = document.getElementById('modalBox');
        let panel = document.getElementById('snmpTestPanel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'snmpTestPanel';
            document.body.appendChild(panel);
        }
        const boxRect = box.getBoundingClientRect();
        panel.style.cssText = `position:fixed;top:${boxRect.top}px;left:${boxRect.right+8}px;z-index:10001;background:#fff;border:1px solid #e1e5eb;width:280px;height:${boxRect.height}px;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.15);display:flex;flex-direction:column;`;
        if (boxRect.right + 300 > window.innerWidth) {
            box.style.width = (window.innerWidth - 340) + 'px';
            box.style.maxWidth = (window.innerWidth - 340) + 'px';
            panel.style.left = (window.innerWidth - 320) + 'px';
        }
        if (!panel._initialized) {
            panel._initialized = true;
            const title = I18N.t('snmp_test_console')||'SNMP Test Console';
            panel.innerHTML = `<div style="padding:14px 20px;border-bottom:1px solid #e1e5eb;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
                <h3 style="margin:0;font-size:16px;font-weight:600;color:#2c3e50;"><i class="fas fa-flask"></i> ${title}</h3>
            </div>
            <div style="padding:6px 8px;font-size:11px;color:#999;background:#f8f9fa;border-bottom:1px solid #e1e5eb;flex-shrink:0;">${cfg.ip}:${cfg.port} v${cfg.version}</div>
            <div id="snmpTestContent" style="flex:1;overflow-y:auto;padding:8px 12px;background:#fff;color:#2c3e50;font-family:monospace;font-size:11px;line-height:1.4;min-height:0;"></div>
            <div style="padding:12px 20px;border-top:1px solid #e1e5eb;text-align:right;flex-shrink:0;"><button class="btn" onclick="document.getElementById('snmpTestPanel').remove()">${I18N.t('close')||'Close'}</button></div>`;
        }
        const content = document.getElementById('snmpTestContent');
        if (!content) return;
        const ts = new Date().toLocaleTimeString();
        const logLine = document.createElement('div');
        logLine.innerHTML = `<span style="color:#999;">[${ts}]</span> <span style="color:#4361ee;font-weight:600;">GET</span> <span style="color:#2c3e50;">${Format.esc(oid)}</span> <span style="color:#666;">${Format.esc(name)}</span>`;
        if (desc) logLine.innerHTML += ` <span style="color:#999;">— ${Format.esc(desc.substring(0,40))}</span>`;
        content.appendChild(logLine);
        try {
            const res = await API.post('/snmp-templates/test-oid', {oid, name, ip:cfg.ip, port:cfg.port, community:cfg.community, version:cfg.version});
            const val = res.value !== undefined ? res.value : JSON.stringify(res);
            if (cell) { cell.innerHTML = `<span style="color:#27ae60;font-weight:bold;" title="${Format.esc(String(val))}">${Format.esc(String(val).substring(0,25))}</span>`; }
            const resLine = document.createElement('div');
            resLine.innerHTML = `<span style="color:#27ae60;font-weight:bold;">  → ${Format.esc(String(val))}</span>`;
            content.appendChild(resLine);
        } catch(e) {
            if (cell) { cell.innerHTML = `<span style="color:#e74c3c;" title="${Format.esc(e.message)}">✗</span>`; }
            const errLine = document.createElement('div');
            errLine.innerHTML = `<span style="color:#e74c3c;">  ✗ ${Format.esc(e.message)}</span>`;
            content.appendChild(errLine);
        }
        content.scrollTop = content.scrollHeight;
    },

    async _filterOidModal() {
        const q = (document.getElementById('oidModalSearch')?.value||'').toLowerCase();
        const src = document.getElementById('oidModalSource')?.value||'';
        const resFilter = document.getElementById('oidModalResult')?.value||'';
        // 如果结果筛选器启用了，从API加载结果数据
        let resultMap = {};
        if (resFilter) {
            try {
                const dbResults = await API.get('/snmp-templates/test-results/load');
                resultMap = dbResults || {};
            } catch(e) {}
        }
        let count = 0;
        document.querySelectorAll('#oidModalBody tr').forEach(row => {
            const matchText = (!q || (row.dataset.search||'').includes(q)) &&
                             (!src || (row.dataset.source||'') === src);
            let matchResult = true;
            if (resFilter) {
                const oid = row.getAttribute('data-oid');
                const r = resultMap[oid];
                const resultVal = r ? (r.v || '') : '';
                if (resFilter === 'ok') matchResult = resultVal && !resultVal.startsWith('Err') && resultVal !== 'No response';
                else if (resFilter === 'err') matchResult = !resultVal || resultVal.startsWith('Err') || resultVal === 'No response';
                else matchResult = resultVal === resFilter;
            }
            const match = matchText && matchResult;
            row.style.display = match ? '' : 'none';
            if (match) count++;
        });
        const el = document.getElementById('oidModalCount');
        if (el) el.textContent = count + ' / ' + (this._oidModalData?.length||0) + ' OIDs';
    },

    _exportOids() {
        const isZh = (I18N.lang||'zh')==='zh';
        const rows = [];
        const visible = document.querySelectorAll('#oidModalBody tr:not([style*="display: none"])');
        visible.forEach(row => {
            const cells = row.querySelectorAll('td');
            const desc = cells[1]?.textContent?.trim() || '';
            const name = cells[2]?.textContent?.trim() || '';
            const oid = cells[3]?.textContent?.trim() || '';
            const src = cells[4]?.textContent?.trim() || '';
            rows.push(`"${desc}","${name}","${oid}","${src}"`);
        });
        const csv = '﻿Description,OID Name,OID,MIB Source\n' + rows.join('\n');
        const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = (this._oidModalFilename||'oids') + '.csv';
        a.click(); URL.revokeObjectURL(url);
        App.toast(rows.length + ' OIDs exported', 'success');
    },

    async _viewCiscoDetail(fileId, filename) {
        try {
            const detail = await API.get('/mib-manager/mib-files/' + fileId);
            this._renderOidDetailModal(filename, detail.parsed_oids || [], 'fa-list-alt', fileId);
        } catch(e) {
            App.toast(e.message, 'danger');
        }
    },

    async _viewMibDetail(fileId, filename) {
        try {
            const detail = await API.get('/mib-manager/mib-files/' + fileId);
            this._renderOidDetailModal(filename, detail.parsed_oids || [], 'fa-file-code', fileId);
        } catch(e) {
            App.toast(e.message, 'danger');
        }
    },

    // ── 重新解析 Cisco 列表（增量下载 MIB） ──────────────────────────

    async _reparseCisco(fileId, filename) {
        const overlay = document.getElementById('modalOverlay');
        const box = document.getElementById('modalBox');
        box.innerHTML = `<div class="modal-header"><h3><i class="fas fa-sync-alt fa-spin"></i> ${I18N.t('re_analyze')||'Re-analyze'}: ${Format.esc(filename)}</h3>
            <button class="modal-close" onclick="App.closeModal()">&times;</button></div>
            <div class="modal-body">
                <div id="reparseLog" style="background:#1a1a2e;color:#0f0;font-family:monospace;font-size:11px;padding:10px;border-radius:6px;height:280px;overflow-y:auto;white-space:pre-wrap;line-height:1.4;"></div>
            </div>
            <div class="modal-footer">
                <span id="reparseElapsed" style="color:#999;font-size:12px;"></span>
                <span id="reparseStats" style="color:#999;font-size:12px;margin-right:auto;"></span>
                <button class="btn" onclick="App.closeModal()">${I18N.t('cancel')}</button>
            </div>`;
        overlay.style.display = 'flex';

        const log = (msg) => {
            const el = document.getElementById('reparseLog');
            if (el) { el.textContent += msg + '\n'; el.scrollTop = el.scrollHeight; }
        };
        const startTime = Date.now();
        const timer = setInterval(() => {
            const el = document.getElementById('reparseElapsed');
            if (el) el.textContent = 'Elapsed: ' + Math.floor((Date.now()-startTime)/1000) + 's';
        }, 500);

        log(`[${new Date().toLocaleTimeString()}] 开始重新解析: ${filename}`);

        try {
            const res = await fetch('/api/mib-manager/reparse-cisco/' + fileId, { method: 'POST' });
            if (!res.ok) { log(`[ERROR] HTTP ${res.status}`); clearInterval(timer); return; }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const l of lines) {
                    if (!l.trim()) continue;
                    try {
                        const d = JSON.parse(l.trim());
                        if (d.log) log(`[${new Date().toLocaleTimeString()}] ${d.log}`);
                        if (d.stat) document.getElementById('reparseStats').textContent = d.stat;
                        if (d.done) {
                            clearInterval(timer);
                            log(`\n[DONE] ${d.stat}`);
                            setTimeout(() => { App.closeModal(); MibManagerPage._loadTab('cisco'); App.toast(d.stat, 'success'); }, 1500);
                        }
                    } catch(e) {}
                }
            }
        } catch(e) { log(`[ERROR] ${e.message}`); }
        clearInterval(timer);
    },

    // ── 删除操作 ────────────────────────────────────────────────────────

    async _deleteMib(id) {
        if (!confirm(I18N.t('delete_confirm'))) return;
        await API.del('/mib-manager/mib-files/' + id);
        App.toast(I18N.t('updated_success'), 'success');
        this._loadTab(this.activeTab);
    },

    _escJs(s) { if(!s)return''; return s.replace(/'/g,"\\'").replace(/"/g,'&quot;').replace(/</g,'&lt;'); },
};
