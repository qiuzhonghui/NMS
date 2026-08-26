/**
 * Context Menu Component — right-click menus for topology and rack views.
 */
const ContextMenu = {
    currentContext: null,
    currentMenuType: null,

    /**
     * Show a context menu at the specified position.
     * @param {number} x - Mouse X position
     * @param {number} y - Mouse Y position
     * @param {string} menuType - Key from CONSTANTS.CONTEXT_MENUS
     * @param {Object} context - Context data for action handlers
     */
    show(x, y, menuType, context) {
        const menu = document.getElementById('contextMenu');
        if (!menu) return;

        this.currentContext = context;
        this.currentMenuType = menuType;

        const items = CONSTANTS.CONTEXT_MENUS[menuType] || [];
        menu.innerHTML = items.map(item => {
            if (item.type === 'separator') {
                return '<div class="context-menu-separator"></div>';
            }
            return `
                <div class="context-menu-item" data-action="${item.action}">
                    <i class="fas ${item.icon}"></i> ${item.label}
                </div>
            `;
        }).join('');

        // Position menu
        menu.style.display = 'block';
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';

        // Keep menu in viewport
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = (x - rect.width) + 'px';
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = (y - rect.height) + 'px';
        }

        // Bind click handlers
        menu.querySelectorAll('.context-menu-item').forEach(el => {
            el.onclick = (e) => {
                e.stopPropagation();
                const action = el.dataset.action;
                menu.style.display = 'none';
                this._handleAction(action, context);
            };
        });
    },

    /**
     * Hide the context menu.
     */
    hide() {
        const menu = document.getElementById('contextMenu');
        if (menu) menu.style.display = 'none';
    },

    /**
     * Handle a context menu action.
     */
    _handleAction(action, context) {
        switch (action) {
        case 'edit':        this._editNode(context); break;
        case 'rename':      this._renameNode(context); break;
        case 'change_icon': this._changeIcon(context); break;
        case 'delete':      this._deleteNode(context); break;
        case 'edit_edge':   this._editEdgeLabel(context); break;
        case 'edge_style':  this._editEdgeStyle(context); break;
        case 'edge_ports':  this._editEdgePorts(context); break;
        case 'delete_edge': this._deleteEdge(context); break;
        case 'note_edit':   if (context.onEdit) context.onEdit(); break;
        case 'note_copy':   this._copyNote(context); break;
        case 'note_delete': if (context.onDelete) context.onDelete(); break;
        case 'remove':      this._removeFromRack(context); break;
        case 'ssh':         this._remoteConnect(context, 'ssh'); break;
        case 'rdp':         this._remoteConnect(context, 'rdp'); break;
        case 'web':         this._remoteConnect(context, 'web'); break;
        case 'dashboard':   this._jumpToDashboard(context); break;
        }
    },

    // ── Node actions ──────────────────────────────────────────────────

    _editNode(context) {
        // Device node → go to device detail for full editing
        if (context.device && context.device.id) {
            App.navigateTo('devices/' + context.device.id);
            return;
        }
        // Manual node → same as rename
        this._renameNode(context);
    },

    _renameNode(context) {
        const node = context.node;
        if (!node) return;
        const newLabel = prompt('New name:', node.label || '');
        if (newLabel && newLabel !== node.label) {
            API.updateTopologyNode(context.nodeId, { label: newLabel, discovery_source: 'manual' })
                .then(() => {
                    App.toast('Name updated', 'success');
                    if (context.onNodeUpdate) context.onNodeUpdate(context.nodeId, { label: newLabel });
                    if (context.onUpdated) context.onUpdated();
                }).catch(e => App.toast('Error: ' + e.message, 'danger'));
        }
    },

    _changeIcon(context) {
        const node = context.node;
        if (!node) return;

        const currentShape = ((node.canvas_data || node.nodeData?.canvas_data || {})?.shape) || 'box';

        const shapes = [
            { id: 'box',        label: '⬜ Rectangle',     desc: 'Default' },
            { id: 'ellipse',    label: '⭕ Ellipse',       desc: 'Router-like' },
            { id: 'circle',     label: '🔵 Circle',        desc: 'Compact' },
            { id: 'database',   label: '🗄️ Database',     desc: 'Server / DB' },
            { id: 'diamond',    label: '🔶 Diamond',       desc: 'Switch / Core' },
            { id: 'hexagon',    label: '⬡ Hexagon',       desc: 'Firewall / Security' },
            { id: 'triangle',   label: '△ Triangle',      desc: 'Gateway' },
            { id: 'star',       label: '★ Star',          desc: 'Critical device' },
        ];

        const colors = [
            { id: '#4361ee', label: 'Blue' },
            { id: '#2ecc71', label: 'Green' },
            { id: '#e74c3c', label: 'Red' },
            { id: '#f39c12', label: 'Orange' },
            { id: '#7209b7', label: 'Purple' },
            { id: '#1abc9c', label: 'Teal' },
            { id: '#34495e', label: 'Dark' },
        ];

        let html = `
            <p style="font-weight:600;margin-bottom:8px;">Shape</p>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;">
                ${shapes.map(s => `
                    <div class="icon-option" data-shape="${s.id}"
                         style="padding:8px 10px;border:2px solid ${currentShape===s.id?'#4361ee':'#ddd'};border-radius:8px;cursor:pointer;text-align:center;font-size:12px;min-width:80px;">
                        <span style="font-size:20px;display:block;">${s.label.split(' ')[0]}</span>
                        ${s.label.split(' ').slice(1).join(' ')}
                        <br><small style="color:#999;">${s.desc}</small>
                    </div>
                `).join('')}
            </div>
            <p style="font-weight:600;margin-bottom:8px;">Border Color</p>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
                ${colors.map(c => `
                    <div class="icon-option" data-color="${c.id}"
                         style="width:32px;height:32px;background:${c.id};border-radius:50%;cursor:pointer;border:2px solid #fff;box-shadow:0 0 0 1px #ddd;"
                         title="${c.label}"></div>
                `).join('')}
            </div>
        `;

        App.showModal('Change Shape & Color — ' + node.label, html);

        // Shape click
        document.querySelectorAll('[data-shape]').forEach(el => {
            el.onclick = () => {
                const shape = el.dataset.shape;
                // Highlight selection
                document.querySelectorAll('[data-shape]').forEach(e => e.style.borderColor = '#ddd');
                el.style.borderColor = '#4361ee';
                // Save shape
                const cd = ((node.canvas_data || node.nodeData?.canvas_data || {})) || {};
                cd.shape = shape;
                API.updateTopologyNode(context.nodeId, { canvas_data: cd, discovery_source: 'manual' })
                    .then(() => {
                        App.toast('Shape updated', 'success');
                        if (context.onUpdated) context.onUpdated();
                    }).catch(e => App.toast('Error: ' + e.message, 'danger'));
                setTimeout(() => App.closeModal(), 300);
            };
        });

        // Color click
        document.querySelectorAll('[data-color]').forEach(el => {
            el.onclick = () => {
                const color = el.dataset.color;
                const cd = ((node.canvas_data || node.nodeData?.canvas_data || {})) || {};
                cd.color = color;
                API.updateTopologyNode(context.nodeId, { canvas_data: cd, discovery_source: 'manual' })
                    .then(() => {
                        App.toast('Color updated', 'success');
                        if (context.onUpdated) context.onUpdated();
                    }).catch(e => App.toast('Error: ' + e.message, 'danger'));
                setTimeout(() => App.closeModal(), 300);
            };
        });
    },

    _deleteNode(context) {
        if (!confirm('Delete this node and all its connections?')) return;
        API.deleteTopologyNode(context.nodeId)
            .then(() => {
                App.toast('Node deleted', 'info');
                if (context.onUpdated) context.onUpdated();
            }).catch(e => App.toast('Error: ' + e.message, 'danger'));
    },

    // ── Edge actions ──────────────────────────────────────────────────

    _editEdgeLabel(context) {
        const edge = context.edge;
        if (!edge) return;
        const newLabel = prompt('Connection label:', edge.label || '');
        if (newLabel !== null && newLabel !== edge.label) {
            API.updateTopologyEdge(context.edgeId, { label: newLabel || '' })
                .then(() => {
                    App.toast('Edge updated', 'success');
                    if (context.onEdgeUpdate) context.onEdgeUpdate(context.edgeId, { label: newLabel });
                    if (context.onUpdated) context.onUpdated();
                }).catch(e => App.toast('Error: ' + e.message, 'danger'));
        }
    },

    _editEdgeStyle(context) {
        const edge = context.edge || {};
        const ed = edge.edgeData || {};
        const current = ed.line_style || 'solid';
        const curArrow = ed.arrowEnabled !== false;

        App.showModal('Edit Line Style', `
            <div style="display:flex;flex-direction:column;gap:10px;">
                <p style="font-weight:600;margin-bottom:4px;">Line Style</p>
                <label style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:4px;cursor:pointer;${current==='solid'?'background:#e8f4fd;':''}">
                    <input type="radio" name="lineStyle" value="solid" ${current==='solid'?'checked':''}>
                    <span style="border-top:3px solid #333;width:60px;display:inline-block;"></span> Solid
                </label>
                <label style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:4px;cursor:pointer;${current==='dashed'?'background:#e8f4fd;':''}">
                    <input type="radio" name="lineStyle" value="dashed" ${current==='dashed'?'checked':''}>
                    <span style="border-top:3px dashed #333;width:60px;display:inline-block;"></span> Dashed
                </label>
                <label style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:4px;cursor:pointer;${current==='dotted'?'background:#e8f4fd;':''}">
                    <input type="radio" name="lineStyle" value="dotted" ${current==='dotted'?'checked':''}>
                    <span style="border-top:3px dotted #333;width:60px;display:inline-block;"></span> Dotted
                </label>
                <p style="font-weight:600;margin:12px 0 4px;">Arrow</p>
                <label style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:4px;cursor:pointer;">
                    <input type="checkbox" name="edgeArrow" ${curArrow ? 'checked' : ''}>
                    Show arrow at target end
                </label>
            </div>
        `, async (box) => {
            const style = box.querySelector('input[name="lineStyle"]:checked').value;
            const arrow = box.querySelector('input[name="edgeArrow"]').checked;
            let dashes = false;
            if (style === 'dashed') dashes = [8, 4];
            else if (style === 'dotted') dashes = [2, 5];
            await API.updateTopologyEdge(context.edgeId, { line_style: style });
            if (context.onEdgeUpdate) {
                context.onEdgeUpdate(context.edgeId, { dashes, arrowEnabled: arrow });
            }
            App.toast('Style updated', 'success');
            if (context.onUpdated) context.onUpdated();
        });
    },

    _editEdgePorts(context) {
        const edge = context.edge;
        const srcPort = (edge && edge.edgeData && edge.edgeData.source_interface) || '';
        const tgtPort = (edge && edge.edgeData && edge.edgeData.target_interface) || '';

        App.showModal('Edit Port Names', `
            <div class="form-group">
                <label>Source Port (from ${edge?.from || '?'})</label>
                <input type="text" id="editSrcPort" class="form-input" value="${srcPort}"
                       placeholder="e.g. Gi0/1, eth0, port 24">
            </div>
            <div class="form-group">
                <label>Target Port (to ${edge?.to || '?'})</label>
                <input type="text" id="editTgtPort" class="form-input" value="${tgtPort}"
                       placeholder="e.g. Gi0/2, eth1, port 12">
            </div>
        `, async (box) => {
            const src = box.querySelector('#editSrcPort').value.trim();
            const tgt = box.querySelector('#editTgtPort').value.trim();
            await API.updateTopologyEdge(context.edgeId, {
                source_interface: src || null,
                target_interface: tgt || null,
            });
            // Update edge label to show ports if provided
            if (src || tgt) {
                const portLabel = [src, tgt].filter(Boolean).join(' → ');
                if (portLabel !== edge.label) {
                    await API.updateTopologyEdge(context.edgeId, { label: portLabel });
                    if (context.onEdgeUpdate) context.onEdgeUpdate(context.edgeId, { label: portLabel });
                }
            }
            App.toast('Port names saved', 'success');
            if (context.onUpdated) context.onUpdated();
        });
    },

    _copyNote(context) {
        const note = context.note;
        if (note && note.content) {
            navigator.clipboard.writeText(note.content).then(() => {
                App.toast('Copied to clipboard', 'success');
            }).catch(() => App.toast('Copy failed', 'danger'));
        }
    },

    _deleteEdge(context) {
        if (!confirm('Delete this connection?')) return;
        API.deleteTopologyEdge(context.edgeId)
            .then(() => {
                App.toast('Edge deleted', 'info');
                if (context.onUpdated) context.onUpdated();
            }).catch(e => App.toast('Error: ' + e.message, 'danger'));
    },

    _removeFromRack(context) {
        if (confirm('Remove this device from the rack?')) {
            API.removeDeviceFromRack(context.rackId, context.deviceId).then(() => {
                App.toast('Device removed from rack', 'info');
                if (typeof RacksPage.showRackDetail === 'function') {
                    RacksPage.showRackDetail(context.rackId);
                }
            }).catch(e => App.toast('Error: ' + e.message, 'danger'));
        }
    },

    _remoteConnect(context, protocol) {
        const device = context.device;
        if (!device) {
            App.toast('No device information available', 'warning');
            return;
        }

        const ip = device.ip_address;
        let url = '';

        switch (protocol) {
        case 'ssh':
            url = `ssh://${ip}`;
            if (device.ssh_port && device.ssh_port !== 22) {
                // For SSH clients that support custom ports
            }
            break;
        case 'rdp':
            url = `rdp://${ip}`;
            break;
        case 'web':
            const port = device.web_port || 80;
            const ssl = port === 443 ? 's' : '';
            url = `http${ssl}://${ip}:${port}`;
            break;
        }

        if (url) {
            window.open(url, '_blank');
        }

        // Also show connection info
        let info = `${protocol.toUpperCase()} connection to ${ip}`;
        if (protocol === 'ssh') info += `:${device.ssh_port || 22}`;
        if (protocol === 'rdp') info += `:${device.rdp_port || 3389}`;
        if (protocol === 'web') info += `:${device.web_port || 80}`;

        App.toast(info, 'info');
    },

    _jumpToDashboard(context) {
        const device = context.device;
        if (device?.id) {
            App.navigateTo('devices/' + device.id);
        }
    },
};
