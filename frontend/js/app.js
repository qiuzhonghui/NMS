/**
 * NMS SPA Application — Router, Navigation, and Shell.
 */
const App = {
    currentPage: null,
    currentParams: null,

    /** Pages registry: hash -> page module (keeps `this` context intact) */
    pages: {
        dashboard:          DashboardPage,
        discovery:          DiscoveryPage,
        'add-device':       AddDevicePage,
        'device-models':    DeviceModelsPage,
        'device-types':     DeviceTypesPage,
        'snmp-templates':   SnmpTemplatesPage,
        'mib-manager':      MibManagerPage,
        'zabbix-templates': ZabbixTemplatesPage,
        'settings':         SettingsPage,
        devices:            DevicesPage,
        'device-detail': DeviceDetailPage,
        topology:        TopologyPage,
        racks:           RacksPage,
        alerts:          AlertsPage,
    },

    /**
     * Initialize the application.
     */
    init() {
        // Connect WebSocket
        NMS_WS.connect();

        // Load version
        fetch('/api/version').then(r=>r.json()).then(d=>{
            const el = document.getElementById('sidebarVersion');
            if (el) el.textContent = 'v'+d.version;
        }).catch(()=>{});

        // Apply i18n on first load
        if (typeof I18N !== 'undefined') I18N.apply();

        // Sub-menu toggle
        this._initSubMenus();

        // Listen for hash changes
        window.addEventListener('hashchange', () => this.route());
        window.addEventListener('load', () => this.route());

        // Close context menu on click outside
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('contextMenu');
            if (menu && !menu.contains(e.target)) {
                menu.style.display = 'none';
            }
        });
    },

    _initSubMenus() {
        document.querySelectorAll('.nav-parent').forEach(parent => {
            parent.addEventListener('click', (e) => {
                const group = parent.closest('.nav-group');
                if (group) {
                    e.preventDefault();
                    group.classList.toggle('open');
                }
            });
        });
    },

    _updateSubMenus(pageName) {
        const devicePages = ['devices', 'device-models', 'device-types', 'device-detail'];
        const monitoringPages = ['snmp-templates', 'mib-manager', 'zabbix-templates'];
        const group = document.getElementById('navGroupDevices');
        if (group) {
            group.classList.toggle('open', devicePages.includes(pageName));
        }
        const group2 = document.getElementById('navGroupMonitoring');
        if (group2) {
            group2.classList.toggle('open', monitoringPages.includes(pageName));
        }
    },

    /**
     * Route to the page specified in the URL hash.
     */
    async route() {
        const hash = window.location.hash.slice(1) || '/';

        // Parse route: "#/devices/abc123" -> page="devices", params=["abc123"]
        const parts = hash.replace(/^#?\/?/, '').split('/').filter(Boolean);

        let pageName = parts[0] || 'dashboard';
        const params = parts.slice(1);

        // Special case: /devices/:id -> device detail page
        if (pageName === 'devices' && params.length > 0) {
            pageName = 'device-detail';
        }

        // Destroy previous page
        if (this.currentPage && this.pages[this.currentPage]?.destroy) {
            this.pages[this.currentPage].destroy();
        }

        // Render new page
        const page = this.pages[pageName];
        if (!page) {
            this.navigateTo('dashboard');
            return;
        }

        // Update active nav
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        const navItem = document.querySelector(`[data-page="${pageName === 'device-detail' ? 'devices' : pageName}"]`);
        if (navItem) navItem.classList.add('active');

        try {
            await page.render(params);
            this.currentPage = pageName;
            this.currentParams = params;
            this._updateSubMenus(pageName);
            if (typeof I18N !== 'undefined') I18N.apply();
            // 初始化表格列宽拖拽
            setTimeout(() => { if (typeof TableResize !== 'undefined') TableResize.initAll(); }, 200);
        } catch (e) {
            console.error(`Error rendering page ${pageName}:`, e);
            document.getElementById('pageContainer').innerHTML = `
                <div class="page-error">
                    <h2>Error loading page</h2>
                    <p>${e.message}</p>
                </div>`;
        }
    },

    /**
     * Navigate to a page.
     */
    navigateTo(page) {
        window.location.hash = '#/' + page;
    },

    /**
     * Show a toast notification.
     */
    toast(message, type = 'info', duration = 4000) {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `<span>${message}</span>`;
        container.appendChild(toast);

        // Trigger animation
        requestAnimationFrame(() => toast.classList.add('toast-show'));

        setTimeout(() => {
            toast.classList.remove('toast-show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    /**
     * Show a modal dialog.
     *
     * opts (optional):
     *   - footer: 'none' (hide footer) | HTML string (custom footer)
     *   - saveLabel / cancelLabel: button text
     * Behavior is unchanged when opts is omitted (legacy callers).
     */
    showModal(title, contentHtml, onSave, opts = {}) {
        const overlay = document.getElementById('modalOverlay');
        const box = document.getElementById('modalBox');

        let footerHtml = '';
        if (opts.footer === 'none') {
            footerHtml = '';
        } else if (typeof opts.footer === 'string') {
            footerHtml = opts.footer;
        } else {
            const saveLabel = opts.saveLabel || 'Save';
            const cancelLabel = opts.cancelLabel || 'Cancel';
            footerHtml = `
                <div class="modal-footer">
                    <button class="btn" onclick="App.closeModal()">${cancelLabel}</button>
                    <button class="btn btn-primary" id="modalSaveBtn">${saveLabel}</button>
                </div>
            `;
        }

        box.innerHTML = `
            <div class="modal-header">
                <h3>${title}</h3>
                <button class="modal-close" onclick="App.closeModal()">&times;</button>
            </div>
            <div class="modal-body">${contentHtml}</div>
            ${footerHtml}
        `;

        overlay.style.display = 'flex';

        if (onSave) {
            const saveBtn = document.getElementById('modalSaveBtn');
            if (saveBtn) {
                saveBtn.onclick = async () => {
                    try {
                        await onSave(box);
                        this.closeModal();
                    } catch (e) {
                        this.toast(e.message, 'danger');
                    }
                };
            }
        }
    },

    /**
     * Check for NMS update by comparing local vs server version.
     */
    async checkUpdate() {
        try {
            const localVer = document.getElementById('sidebarVersion')?.textContent?.replace('v','') || '0';
            const res = await fetch('/api/version').then(r=>r.json());
            const serverVer = res.version || '0';
            if (serverVer !== localVer) {
                App.toast(`New version available: v${serverVer} (current: v${localVer}). Run update on server.`, 'warning', 8000);
            } else {
                App.toast(`Already up to date: v${localVer}`, 'success');
            }
        } catch(e) { App.toast('Update check failed: '+e.message, 'danger'); }
    },

    /**
     * Close the modal.
     */
    closeModal() {
        document.getElementById('modalOverlay').style.display = 'none';
    },
};

// Boot when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());
