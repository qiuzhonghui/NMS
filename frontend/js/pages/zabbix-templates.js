/**
 * Zabbix Templates page — browse Zabbix 7.0 template repo,
 * preview conversions, and import into NMS.
 */
const ZabbixTemplatesPage = {
    repoData: null,        // {folders: {app: [...], db: [...], ...}}
    preview: null,         // current preview data
    importedList: [],      // imported zabbix templates
    activeTab: 'repo',     // 'repo' | 'imported'
    previewPath: null,     // current preview path
    _pollTimer: null,      // progress polling interval id
    _scanLogs: [],         // accumulated scan logs
    _proxyUrl: null,
    _searchQuery: '',      // current search filter
    _pageVer: 'v1.2.27',

    async render() {
        document.getElementById('pageContainer').innerHTML = `
        <div class="page-header">
            <h2><i class="fas fa-cloud-download-alt"></i> ${I18N.t('zabbix_templates') || 'Zabbix Templates'} <span style="font-size:11px;color:#999;">${this._pageVer}</span></h2>
        </div>
        <div class="page-toolbar">
            <div class="page-toolbar-left">
                <button class="btn ${this.activeTab === 'repo' ? 'btn-primary' : ''}" onclick="ZabbixTemplatesPage._switchTab('repo')">
                    <i class="fas fa-globe"></i> ${I18N.t('zabbix_repo') || 'Zabbix Repo'}
                </button>
                <button class="btn ${this.activeTab === 'imported' ? 'btn-primary' : ''}" onclick="ZabbixTemplatesPage._switchTab('imported')">
                    <i class="fas fa-check-circle"></i> ${I18N.t('already_imported') || 'Imported'}
                </button>
            </div>
            <div class="page-toolbar-right" style="display:flex;gap:8px;align-items:center;">
                <span style="position:relative;display:inline-block;">
                    <input id="zabbixSearch" type="text" placeholder="Search templates..."
                        style="padding:5px 28px 5px 10px;border:1px solid #ddd;border-radius:4px;width:200px;font-size:13px;"
                        oninput="ZabbixTemplatesPage._onSearch(this.value)">
                    <button id="zabbixSearchClear" onclick="ZabbixTemplatesPage._clearSearch()"
                        style="display:none;position:absolute;right:4px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:#999;font-size:16px;padding:2px 4px;line-height:1;" title="Clear search">&times;</button>
                </span>
                <button class="btn btn-sm" onclick="ZabbixTemplatesPage._refreshRepo()" title="Refresh repository cache">
                    <i class="fas fa-sync-alt"></i> Refresh
                </button>
                ${this.activeTab === 'repo' ? `
                <button class="btn btn-sm" onclick="ZabbixTemplatesPage._showProxySettings()" title="Proxy settings">
                    <i class="fas fa-cog"></i> Proxy
                </button>` : ''}
            </div>
        </div>
        <div id="zabbixContent"><div class="spinner"></div></div>`;

        if (this.activeTab === 'repo') {
            await this._loadRepo(false);  // don't force refresh on page open
        } else {
            await this._loadImported();
        }
    },

    destroy() {
        this._stopPolling();
    },

    _stopPolling() {
        if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    },

    async _switchTab(tab) {
        this._stopPolling();
        this.activeTab = tab;
        this.preview = null;
        this.previewPath = null;
        await this.render();
    },

    _onSearch(q) {
        this._searchQuery = q.trim().toLowerCase();
        const btn = document.getElementById('zabbixSearchClear');
        if (btn) btn.style.display = this._searchQuery ? 'block' : 'none';
        this._renderRepoBrowser();
    },

    _clearSearch() {
        this._searchQuery = '';
        const inp = document.getElementById('zabbixSearch');
        const btn = document.getElementById('zabbixSearchClear');
        if (inp) { inp.value = ''; inp.focus(); }
        if (btn) btn.style.display = 'none';
        this._renderRepoBrowser();
    },

    _filterFiles(files) {
        if (!this._searchQuery) return files;
        return files.filter(f => f.name.toLowerCase().includes(this._searchQuery) || f.path.toLowerCase().includes(this._searchQuery));
    },

    _highlight(text) {
        if (!this._searchQuery) return Format.esc(text);
        const esc = Format.esc(text);
        const q = Format.esc(this._searchQuery);
        const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
        return esc.replace(re, '<mark style="background:#fff3b0;padding:0 1px;">$1</mark>');
    },

    /** Group files at vendor level: use first TWO path segments as key.
     *  "net/cisco/catalyst_3750/template.yaml" → key="net/cisco", label="cisco/"
     *  "net/template.yaml"                     → key="net",      label="(direct)"
     *  "app/apache_http/template.yaml"          → key="app/apache_http", label="apache_http/"
     */
    _groupByParent(files) {
        const groups = {};
        files.forEach(f => {
            const parts = f.path.split('/');
            // Use first 2 segments as group key, or just the first if only 2 segments total
            const key = parts.length >= 3 ? parts[0] + '/' + parts[1] : parts[0];
            if (!groups[key]) groups[key] = [];
            groups[key].push(f);
        });
        return groups;
    },

    _renderSubGroup(key, subFiles, topFolder) {
        // key is like "net/cisco" or "app/apache_http" or just "net"
        const parts = key.split('/');
        const label = parts.length >= 2
            ? '<i class="fas fa-chevron-right zg-chevron" style="transition:transform 0.2s;margin-right:4px;"></i><i class="fas fa-folder" style="color:#f39c12;margin-right:4px;"></i>' + Format.esc(parts[1])
            : '<i class="fas fa-chevron-right zg-chevron" style="transition:transform 0.2s;margin-right:4px;"></i><i class="fas fa-level-down-alt" style="margin-right:4px;"></i>(direct)';
        const gid = 'zg_' + key.replace(/[^a-zA-Z0-9]/g, '_');
        return `
        <div class="zg-subgroup-header" onclick="ZabbixTemplatesPage._toggleSubGroup('${gid}', this)"
             style="padding:6px 16px 4px 32px;font-size:13px;color:#555;font-weight:600;background:#f0f2f5;border-top:1px solid #e0e3e8;cursor:pointer;user-select:none;">
            ${label}
            <span style="color:#999;font-weight:400;margin-left:6px;">${subFiles.length} templates</span>
        </div>
        <div id="${gid}" class="zg-subgroup-body" style="display:none;">
            ${subFiles.map(f => this._renderFileRow(f)).join('')}
        </div>`;
    },

    _toggleSubGroup(gid, header) {
        const body = document.getElementById(gid);
        const chev = header.querySelector('.zg-chevron');
        if (body) {
            const open = body.style.display !== 'none';
            body.style.display = open ? 'none' : 'block';
            if (chev) chev.style.transform = open ? 'rotate(0deg)' : 'rotate(90deg)';
        }
    },

    _renderFileRow(f) {
        return `<div class="zabbix-file-row" style="padding:8px 16px 8px 48px;border-top:1px solid #f0f0f0;display:flex;justify-content:space-between;align-items:center;">
            <span>
                <i class="fas fa-file-code" style="color:#4a6cf7;margin-right:8px;"></i>
                <span title="${Format.esc(f.path)}" style="font-size:13px;">${this._highlight(f.name)}</span>
            </span>
            <span style="display:flex;gap:4px;">
                <button class="btn btn-sm" onclick="ZabbixTemplatesPage._showPreview('${Format.esc(f.path)}')">
                    <i class="fas fa-eye"></i> Preview
                </button>
                <button class="btn btn-sm btn-primary" onclick="ZabbixTemplatesPage._quickImport('${Format.esc(f.path)}', '${Format.esc(f.name)}')">
                    <i class="fas fa-download"></i> Import
                </button>
            </span>
        </div>`;
    },

    // ── Repo Browser ────────────────────────────────────────────────

    async _loadRepo(force = false) {
        const c = document.getElementById('zabbixContent');
        c.innerHTML = `<div class="spinner"></div>`;

        try {
            this.repoData = await API.getZabbixRepoFiles(force);
        } catch (e) {
            c.innerHTML = `<div class="empty-state">
                <p style="color:#e74c3c;">${Format.esc(e.message)}</p>
                <button class="btn btn-primary" onclick="ZabbixTemplatesPage._loadRepo(true)">
                    <i class="fas fa-redo"></i> Retry
                </button>
            </div>`;
            App.toast(e.message, 'danger');
            return;
        }

        this._renderRepoBrowser();

        // If a background scan is running, start polling
        if (this.repoData && this.repoData.scanning) {
            this._startPolling();
        }
    },

    _startPolling() {
        this._stopPolling();
        this._scanLogs = [];
        this._pollTimer = setInterval(async () => {
            try {
                const p = await API.getZabbixRepoStatus();
                this._scanLogs = p.logs || [];
                this._renderProgress(p);
                this._renderLogs();
                if (!p.scanning) {
                    this._stopPolling();
                    // Reload repo data to get the new cache
                    await this._loadRepo();
                }
            } catch (e) { /* ignore poll errors */ }
        }, 500);
    },

    _renderProgress(p) {
        if (!p || !p.scanning) return;
        const c = document.getElementById('zabbixContent');
        let bar = document.getElementById('zabbixProgress');
        const html = `
        <div id="zabbixProgress" style="margin-bottom:10px;padding:12px 16px;background:#f0f7ff;border:1px solid #b8d4f0;border-radius:6px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span><i class="fas fa-sync-alt fa-spin" style="color:#4a6cf7;margin-right:8px;"></i>
                    <strong>${Format.esc(p.current_status || 'Scanning...')}</strong></span>
                <span style="font-size:13px;color:#666;">
                    ${p.folders_done || 0} / ${p.folders_total || 0} folders  |  ${p.files_found || 0} files
                </span>
            </div>
            <div style="background:#dce8f5;border-radius:4px;height:6px;overflow:hidden;">
                <div style="background:#4a6cf7;height:100%;width:${p.folders_total > 0 ? Math.round(p.folders_done / p.folders_total * 100) : 5}%;transition:width 0.3s;"></div>
            </div>
            ${p.current_folder ? `<div style="margin-top:4px;font-size:11px;color:#999;">${Format.esc(p.current_folder)}/</div>` : ''}
            ${p.error ? `<div style="margin-top:4px;font-size:12px;color:#e74c3c;">Error: ${Format.esc(p.error)}</div>` : ''}
        </div>`;
        if (bar) {
            bar.outerHTML = html;
        } else {
            c.insertAdjacentHTML('afterbegin', html);
        }
    },

    _renderLogs() {
        if (!this._scanLogs || this._scanLogs.length === 0) return;
        const c = document.getElementById('zabbixContent');
        let logBox = document.getElementById('zabbixLogs');
        const logHtml = this._buildLogsHtml();
        if (logBox) {
            logBox.outerHTML = logHtml;
        } else {
            c.insertAdjacentHTML('afterbegin', logHtml);
        }
    },

    _showProxySettings() {
        const currentProxy = this._proxyUrl || '';
        App.showModal('Proxy Settings', `
            <div style="padding:8px 0;">
                <p style="color:#666;margin-bottom:12px;">
                    Configure HTTP/HTTPS proxy for accessing <code>git.zabbix.com</code>.
                    <br>Leave blank to use direct connection.
                </p>
                <label style="display:block;margin-bottom:4px;font-weight:600;">Proxy URL</label>
                <p style="font-size:11px;color:#999;margin:0 0 4px 0;">
                    Enter ONE proxy URL (used for both HTTP and HTTPS). Format: <code>http://host:port</code>
                </p>
                <div style="display:flex;gap:8px;">
                    <input id="proxyUrlInput" class="form-input" style="flex:1;padding:8px;"
                           placeholder="e.g. http://10.1.0.2:7897"
                           value="${Format.esc(currentProxy)}">
                    <button class="btn btn-sm" onclick="ZabbixTemplatesPage._testProxy()" type="button">
                        <i class="fas fa-plug"></i> Test
                    </button>
                </div>
                <div id="proxyTestResult" style="margin-top:8px;font-size:12px;"></div>
                <p style="margin-top:8px;font-size:12px;color:#999;">
                    One URL proxies both HTTP and HTTPS traffic.
                    <br>Examples: http://10.1.0.2:7897, socks5://proxy:1080
                </p>
            </div>
        `, async (box) => {
            const url = box.querySelector('#proxyUrlInput').value.trim();
            try {
                const r = await API.setZabbixProxy(url);
                this._proxyUrl = r.proxy;
                const testMsg = r.test_ok
                    ? `${r.test_result} — Proxy works!`
                    : `Proxy saved but test failed: ${r.test_result}`;
                App.toast(testMsg, r.test_ok ? 'success' : 'warning', 6000);
            } catch (e) {
                App.toast(e.message, 'danger');
            }
        });
        API.getZabbixProxy().then(r => {
            this._proxyUrl = r.proxy;
            const inp = document.getElementById('proxyUrlInput');
            if (inp) inp.value = r.proxy || '';
        }).catch(() => {});
    },

    async _testProxy() {
        const url = document.getElementById('proxyUrlInput').value.trim();
        const resultEl = document.getElementById('proxyTestResult');
        resultEl.innerHTML = '<span style="color:#999;"><i class="fas fa-spinner fa-spin"></i> Testing...</span>';
        try {
            const r = await API.post('/zabbix-templates/repo/test-connection', { url: url || '' });
            if (r.ok) {
                resultEl.innerHTML = `<span style="color:#27ae60;"><i class="fas fa-check-circle"></i> ${r.message}</span>`;
                App.toast('Connection successful!', 'success');
            } else {
                resultEl.innerHTML = `<span style="color:#e74c3c;"><i class="fas fa-times-circle"></i> ${r.message}</span>`;
            }
        } catch (e) {
            resultEl.innerHTML = `<span style="color:#e74c3c;">${Format.esc(e.message)}</span>`;
        }
    },

    _renderRepoBrowser() {
        const c = document.getElementById('zabbixContent');
        // Keep logs visible if they exist
        const logsHtml = this._scanLogs && this._scanLogs.length > 0
            ? this._buildLogsHtml() : '';
        const folders = this.repoData.folders || {};
        const folderNames = Object.keys(folders).sort();
        const totalFiles = this.repoData.total_files || 0;
        const age = this.repoData.cache_age_seconds;

        let cacheInfo = '';
        if (age !== null && age !== undefined) {
            const mins = Math.floor(age / 60);
            cacheInfo = `<span style="color:#999;font-size:12px;margin-left:10px;">
                ${I18N.t('cached') || 'Cached'}: ${mins < 1 ? '<1m' : mins + 'm'} ago
            </span>`;
        }

        let html = `
        <div style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;">
            <div>
                <span style="font-weight:600;">${totalFiles} ${I18N.t('templates') || 'templates'} ${I18N.t('in') || 'in'} ${folderNames.length} ${I18N.t('folders') || 'folders'}</span>
                ${cacheInfo}
            </div>
            <button class="btn btn-sm" onclick="ZabbixTemplatesPage._refreshRepo()">
                <i class="fas fa-sync-alt"></i> ${I18N.t('refresh_repo') || 'Refresh Repo'}
            </button>
        </div>`;

        if (folderNames.length === 0) {
            html += `<div class="empty-state"><p>${I18N.t('no_zabbix_files') || 'No files found. Try refreshing.'}</p></div>`;
            html = logsHtml + html;
            c.innerHTML = html;
            return;
        }

        for (const folder of folderNames) {
            const files = this._filterFiles(folders[folder] || []);
            if (files.length === 0 && this._searchQuery) continue;  // hide empty folders during search
            const groups = this._groupByParent(files);
            const parentKeys = Object.keys(groups).sort();

            let subHtml = '';
            for (const pk of parentKeys) {
                subHtml += this._renderSubGroup(pk, groups[pk], folder);
            }

            html += `
            <div class="card" style="margin-bottom:8px;padding:0;">
                <div class="zabbix-folder-header" onclick="ZabbixTemplatesPage._toggleFolder(this)"
                     style="padding:12px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;background:#f8f9fa;border-radius:4px 4px 0 0;">
                    <span><i class="fas fa-folder" style="color:#e67e22;margin-right:8px;"></i>
                        <strong>${Format.esc(folder)}</strong>
                        <span style="color:#999;margin-left:8px;">${files.length}${this._searchQuery ? ' / ' + (folders[folder]||[]).length : ''} templates</span>
                    </span>
                    <i class="fas fa-chevron-right folder-chevron" style="transition:transform 0.2s;"></i>
                </div>
                <div class="zabbix-folder-body" style="display:none;">
                    ${subHtml}
                </div>
            </div>`;
        }

        html = logsHtml + html;
        c.innerHTML = html;
    },

    _toggleFolder(header) {
        const body = header.nextElementSibling;
        const chevron = header.querySelector('.folder-chevron');
        const sy = window.scrollY;  // remember scroll before DOM change
        if (body.style.display === 'none') {
            body.style.display = 'block';
            chevron.style.transform = 'rotate(90deg)';
        } else {
            body.style.display = 'none';
            chevron.style.transform = 'rotate(0deg)';
        }
        window.scrollTo(0, sy);  // restore scroll position
    },

    async _refreshRepo() {
        try {
            const r = await API.refreshZabbixRepo();
            if (r.status === 'already_scanning') {
                App.toast('Scan already in progress...', 'info');
            } else {
                App.toast('Scan started — discovering folders...', 'info');
            }
        } catch (e) {
            App.toast(e.message, 'danger');
        }
        // Show progress bar immediately and start polling
        this._startPolling();
    },

    // ── Preview ──────────────────────────────────────────────────

    async _showPreview(path) {
        this.previewPath = path;
        const c = document.getElementById('zabbixContent');

        // Show loading in a preview card
        const html = this._renderRepoBrowserHtml() + `
        <div class="card" id="zabbixPreviewCard" style="margin-top:16px;padding:16px;">
            <div class="spinner"></div>
        </div>`;
        c.innerHTML = html;

        try {
            this.preview = await API.previewZabbixTemplate(path);
        } catch (e) {
            document.getElementById('zabbixPreviewCard').innerHTML = `
                <p style="color:#e74c3c;">${Format.esc(e.message)}</p>`;
            App.toast(e.message, 'danger');
            return;
        }
        this._renderPreviewCard();
    },

    _renderPreviewCard() {
        const p = this.preview;
        if (!p) return;
        const card = document.getElementById('zabbixPreviewCard');
        if (!card) return;

        const groups = (p.template_groups || []).join(', ') || '-';
        const desc = p.description ? `<p style="color:#666;margin:8px 0;">${Format.esc(p.description)}</p>` : '';

        let itemsHtml = '';
        if (p.items && p.items.length > 0) {
            itemsHtml = `
            <table class="data-table" style="width:100%;margin-top:12px;">
                <thead><tr>
                    <th><input type="checkbox" checked onchange="ZabbixTemplatesPage._toggleAllItems(this)"></th>
                    <th>${I18N.t('metric_name') || 'Metric'}</th>
                    <th>OID / Key</th>
                    <th>${I18N.t('protocol') || 'Protocol'}</th>
                    <th>Unit</th>
                    <th>Interval</th>
                </tr></thead>
                <tbody>
                ${p.items.map((item, i) => `
                    <tr>
                        <td><input type="checkbox" class="zabbix-item-cb" checked value="${Format.esc(item.metric_name)}"></td>
                        <td title="${Format.esc(item.metric_type)}">${Format.esc(item.metric_name)}</td>
                        <td style="font-size:12px;font-family:monospace;">${Format.esc(item.oid_or_key)}</td>
                        <td><span class="badge">${Format.esc(item.protocol)}</span></td>
                        <td>${Format.esc(item.unit) || '-'}</td>
                        <td>${item.interval_seconds}s</td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
            if (p.item_count > 50) {
                itemsHtml += `<p style="color:#999;font-size:12px;margin-top:4px;">${I18N.t('showing') || 'Showing'} 50 / ${p.item_count} ${I18N.t('items') || 'items'}</p>`;
            }
        }

        card.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:10px;">
                <div style="flex:1;min-width:250px;">
                    <h3 style="margin:0 0 4px 0;">${Format.esc(p.name)}</h3>
                    <span style="color:#999;font-size:13px;">
                        ${I18N.t('vendor') || 'Vendor'}: ${Format.esc(p.vendor)} ${Format.esc(p.vendor_version || '')}
                        &nbsp;|&nbsp; ${I18N.t('group') || 'Group'}: ${Format.esc(groups)}
                    </span>
                    ${desc}
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                    <span style="font-size:13px;color:#666;">${p.item_count} ${I18N.t('items') || 'items'}</span>
                    ${p.discovery_rule_count > 0 ? `<span style="font-size:13px;color:#666;">${p.discovery_rule_count} ${I18N.t('discovery_rules') || 'disc'}</span>` : ''}
                    ${p.macro_count > 0 ? `<span style="font-size:13px;color:#666;">${p.macro_count} ${I18N.t('macros') || 'macros'}</span>` : ''}
                </div>
            </div>
            <div style="margin-top:12px;display:flex;gap:8px;">
                <button class="btn btn-primary" onclick="ZabbixTemplatesPage._importSelected()">
                    <i class="fas fa-download"></i> ${I18N.t('import_selected') || 'Import Selected'}
                </button>
                <button class="btn" onclick="ZabbixTemplatesPage._importAll()">
                    <i class="fas fa-download"></i> ${I18N.t('import_all') || 'Import All'}
                </button>
                <button class="btn btn-sm" onclick="ZabbixTemplatesPage._closePreview()">
                    <i class="fas fa-times"></i> Close
                </button>
            </div>
            ${itemsHtml}
        `;
        card.scrollIntoView({ behavior: 'smooth' });
    },

    _toggleAllItems(checkbox) {
        document.querySelectorAll('.zabbix-item-cb').forEach(cb => {
            cb.checked = checkbox.checked;
        });
    },

    _getSelectedItems() {
        const cbs = document.querySelectorAll('.zabbix-item-cb');
        const selected = [];
        cbs.forEach(cb => { if (cb.checked) selected.push(cb.value); });
        return selected;
    },

    _closePreview() {
        this.preview = null;
        this.previewPath = null;
        const card = document.getElementById('zabbixPreviewCard');
        if (card) card.remove();
    },

    _buildLogsHtml() {
        if (!this._scanLogs || this._scanLogs.length === 0) return '';
        const total = this._scanLogs.length;
        const colors = { error: '#e74c3c', warn: '#e67e22', info: '#999' };
        const icons = { error: '✗', warn: '⚠', info: 'ℹ' };
        return `
        <details id="zabbixLogs" open style="margin-bottom:14px;font-size:12px;font-family:monospace;background:#1e1e1e;color:#d4d4d4;border-radius:6px;overflow:hidden;">
            <summary style="padding:8px 14px;background:#2d2d2d;cursor:pointer;color:#ccc;font-family:sans-serif;display:flex;justify-content:space-between;">
                <span><i class="fas fa-terminal"></i> Scan Logs (${total} entries)</span>
                <span style="font-size:11px;color:#888;">errors: ${this._scanLogs.filter(l=>l.level==='error').length} | warnings: ${this._scanLogs.filter(l=>l.level==='warn').length}</span>
            </summary>
            <div style="max-height:400px;overflow-y:auto;padding:6px 14px;">
                ${this._scanLogs.map(l => `<div style="line-height:1.6;color:${colors[l.level]||'#999'};"><span style="color:#666;">${l.ts}</span> ${icons[l.level]||''} ${Format.esc(l.msg)}</div>`).join('')}
            </div>
        </details>`;
    },

    // ── Import ───────────────────────────────────────────────────

    async _quickImport(path, filename) {
        const name = filename.replace(/\.ya?ml$/i, '');
        if (!confirm(`Import "${name}" from Zabbix repo?\nThis will import ALL items from this template.`)) return;

        const c = document.getElementById('zabbixContent');
        c.innerHTML = `<div class="spinner"></div>`;

        try {
            const r = await API.importZabbixTemplate(path, null, null);
            App.toast(`${I18N.t('import_success') || 'Imported'}: ${r.name} (${r.item_count} items)`, 'success');
        } catch (e) {
            App.toast(e.message, 'danger');
        }
        await this._loadRepo();
    },

    async _importSelected() {
        if (!this.previewPath) return;
        const selected = this._getSelectedItems();
        if (selected.length === 0) {
            App.toast(I18N.t('select_items_first') || 'Please select at least one item', 'warning');
            return;
        }
        if (!confirm(`Import ${selected.length} selected items?`)) return;

        const card = document.getElementById('zabbixPreviewCard');
        card.querySelector('.spinner') || (card.innerHTML = '<div class="spinner"></div>');

        try {
            const r = await API.importZabbixTemplate(this.previewPath, null, selected);
            App.toast(`${I18N.t('import_success') || 'Imported'}: ${r.name} (${r.item_count} items)`, 'success');
            this._closePreview();
        } catch (e) {
            App.toast(e.message, 'danger');
            this._renderPreviewCard();
        }
    },

    async _importAll() {
        if (!this.previewPath) return;
        if (!confirm(`Import ALL items from this template?`)) return;

        const card = document.getElementById('zabbixPreviewCard');
        card.innerHTML = '<div class="spinner"></div>';

        try {
            const r = await API.importZabbixTemplate(this.previewPath, null, null);
            App.toast(`${I18N.t('import_success') || 'Imported'}: ${r.name} (${r.item_count} items)`, 'success');
            this._closePreview();
        } catch (e) {
            App.toast(e.message, 'danger');
            this._renderPreviewCard();
        }
    },

    // ── Imported Templates ────────────────────────────────────────

    async _loadImported() {
        const c = document.getElementById('zabbixContent');
        c.innerHTML = `<div class="spinner"></div>`;

        try {
            this.importedList = await API.getZabbixImported() || [];
        } catch (e) {
            c.innerHTML = `<div class="empty-state"><p style="color:#e74c3c;">${Format.esc(e.message)}</p></div>`;
            return;
        }
        this._renderImportedList();
    },

    _renderImportedList() {
        const c = document.getElementById('zabbixContent');
        const list = this.importedList;

        if (list.length === 0) {
            c.innerHTML = `<div class="empty-state">
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;color:#999;text-align:center;">
                    <p style="margin-bottom:16px;color:#999;font-size:14px;">
                        <i class="far fa-folder-open" style="font-size:14px;position:relative;top:2px;margin-right:5px;"></i>${I18N.t('no_imported_zabbix') || 'No imported Zabbix templates yet.'}
                    </p>
                    <button class="btn" onclick="ZabbixTemplatesPage._switchTab('repo')">
                        ${I18N.t('browse_zabbix_repo') || 'Browse Zabbix Repo'}
                    </button>
                </div>
            </div>`;
            return;
        }

        c.innerHTML = `
        <div style="margin-bottom:12px;">
            <span style="font-weight:600;">${list.length} ${I18N.t('imported_templates') || 'imported templates'}</span>
        </div>
        ${list.map(t => `
        <div class="card" style="margin-bottom:12px;padding:14px 20px;cursor:pointer;" onclick="ZabbixTemplatesPage._openImported('${t.id}')">
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <strong>${Format.esc(t.name)}</strong>
                    <span class="badge" style="margin-left:8px;background:#e67e22;color:#fff;">Zabbix</span>
                    <span style="color:#999;margin-left:10px;">${t.item_count || 0} items</span>
                    ${t.description ? `<br><small style="color:#999;">${Format.esc(t.description).substring(0, 120)}</small>` : ''}
                </div>
                <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();ZabbixTemplatesPage._deleteImported('${t.id}','${Format.esc(t.name)}')">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>`).join('')}`;
    },

    _openImported(tid) {
        // Navigate to the snmp-templates detail view for this template
        window.location.hash = '#/snmp-templates';
        // Store template ID to open after render
        sessionStorage.setItem('openTemplateId', tid);
        App.navigateTo('snmp-templates');
    },

    async _deleteImported(tid, name) {
        if (!confirm(`Delete imported template "${name}"?\nThis will also delete all its monitoring items.`)) return;
        try {
            await API.deleteZabbixImported(tid);
            App.toast(`Deleted: ${name}`, 'success');
            await this._loadImported();
        } catch (e) {
            App.toast(e.message, 'danger');
        }
    },

    // ── Helpers ──────────────────────────────────────────────────

    _renderRepoBrowserHtml() {
        // Return HTML string for just the repo browser portion (folders + files)
        // Used by _showPreview to re-render the browser above the preview card
        const folders = this.repoData?.folders || {};
        const folderNames = Object.keys(folders).sort();
        const totalFiles = this.repoData?.total_files || 0;

        let html = `
        <div style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:600;">${totalFiles} ${I18N.t('templates') || 'templates'} ${I18N.t('in') || 'in'} ${folderNames.length} ${I18N.t('folders') || 'folders'}</span>
            <button class="btn btn-sm" onclick="ZabbixTemplatesPage._refreshRepo()">
                <i class="fas fa-sync-alt"></i> ${I18N.t('refresh_repo') || 'Refresh'}
            </button>
        </div>`;

        for (const folder of folderNames) {
            const files = this._filterFiles(folders[folder] || []);
            if (files.length === 0 && this._searchQuery) continue;  // hide empty folders during search
            const groups = this._groupByParent(files);
            const parentKeys = Object.keys(groups).sort();
            let subHtml = '';
            for (const pk of parentKeys) {
                subHtml += this._renderSubGroup(pk, groups[pk], folder);
                subHtml += groups[pk].map(f => this._renderFileRow(f)).join('');
            }

            html += `
            <div class="card" style="margin-bottom:8px;padding:0;">
                <div class="zabbix-folder-header" onclick="ZabbixTemplatesPage._toggleFolder(this)"
                     style="padding:12px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;background:#f8f9fa;border-radius:4px 4px 0 0;">
                    <span><i class="fas fa-folder" style="color:#e67e22;margin-right:8px;"></i>
                        <strong>${Format.esc(folder)}</strong>
                        <span style="color:#999;margin-left:8px;">${files.length}${this._searchQuery ? ' / ' + (folders[folder]||[]).length : ''} templates</span>
                    </span>
                    <i class="fas fa-chevron-right folder-chevron" style="transition:transform 0.2s;"></i>
                </div>
                <div class="zabbix-folder-body" style="display:none;">
                    ${subHtml}
                </div>
            </div>`;
        }
        return html;
    },
};
