/**
 * Topology Page — Canvas-based interactive network map.
 * Replaces vis-network with a custom Canvas 2D rendering engine.
 */
const TopologyPage = {
    // ── Data ──────────────────────────────────────────────────────────────
    devices: [],          // Managed devices from API
    topoNodes: [],        // Topology nodes drawn on canvas
    topoEdges: [],        // Topology edges (connections)
    topoNotes: [],        // Text annotation notes
    selectedNode: null,
    selectedEdge: null,
    selectedNote: null,
    draggingNode: null,
    draggingNote: null,
    isPanning: false,
    isConnecting: false,
    connectSource: null,
    connectSourcePort: null,
    spacePressed: false,

    // ── View state ────────────────────────────────────────────────────────
    scale: 1,
    panX: 0,
    panY: 0,
    lastMouseX: 0,
    lastMouseY: 0,

    // ── Constants ─────────────────────────────────────────────────────────
    GRID_SIZE: 20,
    NODE_DEFAULTS: {
        width: 140,
        height: 80,
        portRadius: 5,
        borderRadius: 8,
        fontSize: 12,
        nameFontSize: 11,
    },

    // ── Color mapping ─────────────────────────────────────────────────────
    _typeColors: {
        router:        '#4361ee',
        switch_:       '#3a0ca3',
        firewall:      '#e74c3c',
        server_linux:  '#2ecc71',
        server_windows:'#3498db',
        other:         '#95a5a6',
    },

    _typeIcons: {
        router:        '\u{1F4E1}',  // satellite antenna
        switch_:       '\u{1F500}',  // shuffle
        firewall:      '\u{1F6E1}',  // shield
        server_linux:  '\u{1F4BB}',  // laptop
        server_windows:'\u{1F5A5}',  // desktop
        other:         '\u{2753}',   // question
    },

    // ══════════════════════════════════════════════════════════════════════
    //  RENDER — page entry point
    // ══════════════════════════════════════════════════════════════════════

    async render() {
        const html = `
        <div class="topology-page">
            <!-- ── Left Sidebar ─────────────────────── -->
            <div class="topo-sidebar" id="topoSidebar">
                <div class="topo-sidebar-header">
                    <div class="topo-sidebar-title">${T('device_library')}</div>
                    <div class="topo-sidebar-subtitle">${T('click_add')}</div>
                </div>
                <div class="topo-sidebar-actions">
                    <button class="topo-sidebar-btn" onclick="TopologyPage._exportTopology()">
                        <i class="fas fa-download"></i> ${T('export_topo')}
                    </button>
                    <button class="topo-sidebar-btn topo-sidebar-btn-import" onclick="TopologyPage._triggerImport()">
                        <i class="fas fa-upload"></i> ${T('import_topo')}
                    </button>
                </div>
                <div class="topo-device-library" id="topoDeviceLibrary">
                    <div class="topo-loading">${T('loading_devices')}</div>
                </div>
                <div class="topo-sidebar-footer">
                    <button class="topo-sidebar-btn topo-sidebar-btn-full" onclick="TopologyPage._addNote()">
                        <i class="fas fa-sticky-note"></i> ${T('add_note')}
                    </button>
                    <button class="topo-sidebar-btn topo-sidebar-btn-full topo-sidebar-btn-discover" onclick="TopologyPage._runAutoDiscovery()">
                        <i class="fas fa-magnifying-glass"></i> ${T('auto_discover')}
                    </button>
                </div>
            </div>

            <!-- ── Canvas Area ──────────────────────── -->
            <div class="topo-canvas-wrap" id="topoCanvasWrap">
                <canvas id="topoCanvas"></canvas>
                <div class="topo-zoom-display" id="topoZoomDisplay">100%</div>
                <div class="topo-canvas-controls">
                    <button class="topo-ctrl-btn" onclick="TopologyPage._zoomIn()" title="Zoom In">+</button>
                    <button class="topo-ctrl-btn" onclick="TopologyPage._zoomOut()" title="Zoom Out">&#8722;</button>
                    <button class="topo-ctrl-btn" onclick="TopologyPage._fitAll()" title="Fit All">
                        <i class="fas fa-expand"></i>
                    </button>
                </div>
                <div class="topo-legend">
                    <div class="topo-legend-item"><span class="topo-legend-dot" style="background:#2ecc71;"></span> ${T('online')}</div>
                    <div class="topo-legend-item"><span class="topo-legend-dot" style="background:#e74c3c;"></span> ${T('offline')}</div>
                    <div class="topo-legend-item"><span class="topo-legend-dot" style="background:#f39c12;"></span> ${T('warning')}</div>
                </div>
                <div class="topo-hint" id="topoHint">
                    <i class="fas fa-project-diagram" style="font-size:48px;color:#ccc;display:block;margin-bottom:12px;"></i>
                    <p>${T('no_topo')}</p>
                    <p>${T('no_topo_hint1')}</p>
                    <p>${T('no_topo_hint2')}</p>
                </div>
            </div>

            <!-- Hidden file input for import -->
            <input type="file" id="topoFileInput" accept=".json" style="display:none;"
                   onchange="TopologyPage._handleImportFile(this)">
        </div>
        `;

        document.getElementById('pageContainer').innerHTML = html;

        // Init canvas
        this.canvas = document.getElementById('topoCanvas');
        this.ctx = this.canvas.getContext('2d');

        // Load data
        await this._loadTopologyData();
        await this._renderSidebar();
        this._setupCanvasEvents();
        this._setupGlobalEvents();
        this._resizeCanvas();
        this._draw();
    },

    destroy() {
        this._teardownGlobalEvents();
        this.canvas = null;
        this.ctx = null;
        this.topoNodes = [];
        this.topoEdges = [];
        this.topoNotes = [];
        this.selectedNode = null;
        this.selectedEdge = null;
        this.selectedNote = null;
    },

    // ══════════════════════════════════════════════════════════════════════
    //  DATA LOADING
    // ══════════════════════════════════════════════════════════════════════

    async _loadTopologyData() {
        try {
            const [topology, devices] = await Promise.all([
                API.getTopology(),
                API.getDevices(),
            ]);
            this.devices = devices;

            // Auto-create topology nodes for managed devices not yet on the map
            const existingDeviceIds = new Set(
                topology.nodes.filter(n => n.device_id).map(n => n.device_id)
            );
            let needReload = false;
            for (const d of devices) {
                if (!existingDeviceIds.has(d.id)) {
                    const count = topology.nodes.length;
                    const col = count % 5, row = Math.floor(count / 5);
                    try {
                        await API.addTopologyNode({
                            device_id: d.id,
                            label: d.name,
                            node_type: 'device',
                            x: col * 200 + 120,
                            y: row * 150 + 100,
                        });
                        needReload = true;
                    } catch (e) { /* duplicate, ignore */ }
                }
            }

            if (needReload) {
                const updated = await API.getTopology();
                this._buildNodes(updated.nodes, updated.edges, devices);
            } else {
                this._buildNodes(topology.nodes, topology.edges, devices);
            }

            this._updateHint();
        } catch (e) {
            App.toast('Failed to load topology: ' + e.message, 'danger');
        }
    },

    _buildNodes(nodes, edges, devices) {
        this.topoNodes = nodes.map(n => {
            const device = n.device_id ? devices.find(d => d.id === n.device_id) : null;
            const typeCfg = CONSTANTS.DEVICE_TYPES[device?.device_type] || CONSTANTS.DEVICE_TYPES.other;
            const statusColor = device ? (CONSTANTS.STATUS_COLORS[device.status] || '#95a5a6') : '#95a5a6';
            const cd = n.canvas_data || {};
            const nodeColor = cd.color || this._typeColors[device?.device_type] || '#4361ee';

            // Determine node dimensions based on port count (if device) or defaults
            const portCount = device ? (device.interfaces_count || 24) : 0;
            const w = portCount > 24 ? 170 : (portCount > 12 ? 155 : this.NODE_DEFAULTS.width);
            const h = portCount > 24 ? 100 : (portCount > 12 ? 90 : this.NODE_DEFAULTS.height);

            return {
                id: n.id,
                label: n.label || device?.name || 'Unnamed',
                deviceId: n.device_id,
                nodeType: n.node_type || 'device',
                x: n.x || 100,
                y: n.y || 100,
                width: cd.width || w,
                height: cd.height || h,
                color: nodeColor,
                statusColor: statusColor,
                deviceType: device?.device_type || 'other',
                device: device,
                // Ports: generate simple port set based on device interfaces
                ports: this._generateSimplePorts(portCount || 8, device?.device_type || 'other'),
                notes: (cd.notes || []),
                discoverySource: n.discovery_source || null,
            };
        });

        this.topoEdges = edges.map(e => ({
            id: e.id,
            sourceNodeId: e.source_node_id,
            targetNodeId: e.target_node_id,
            label: e.label || '',
            sourceInterface: e.source_interface || '',
            targetInterface: e.target_interface || '',
            lineStyle: e.line_style || 'solid',
            color: e.color || '#8899aa',
            labelOffsetX: (e.canvas_data?.labelOffsetX) || 0,
            labelOffsetY: (e.canvas_data?.labelOffsetY) || 0,
            sourceSide: (e.canvas_data?.sourceSide) || null,
            targetSide: (e.canvas_data?.targetSide) || null,
        }));

        // Restore notes from topology nodes' canvas_data
        nodes.forEach(n => {
            const cd = n.canvas_data || {};
            if (cd.notes && Array.isArray(cd.notes)) {
                cd.notes.forEach(noteData => {
                    this.topoNotes.push({
                        id: noteData.id || ('note-' + Date.now() + Math.random().toString(36).substr(2, 9)),
                        content: noteData.content,
                        x: noteData.x,
                        y: noteData.y,
                        width: noteData.width || 200,
                        height: noteData.height || 100,
                    });
                });
            }
        });

        // Restore view state from first node's canvas_data or preserved
        const savedView = nodes.length > 0 ? (nodes[0].canvas_data?.view || null) : null;
        if (savedView) {
            this.scale = savedView.scale || 1;
            this.panX = savedView.panX || 0;
            this.panY = savedView.panY || 0;
        }
    },

    _generateSimplePorts(count, deviceType) {
        // Generate simple port representations for visual indicators
        const ports = [];
        const prefix = deviceType === 'switch_' ? 'Gi1/0/' : (deviceType === 'router' ? 'Gi0/0/' : 'eth');
        for (let i = 0; i < count; i++) {
            ports.push({
                id: 'port-' + (i + 1),
                name: prefix + (i + 1),
                number: i + 1,
                connected: false,
            });
        }
        return ports;
    },

    _updateHint() {
        const hint = document.getElementById('topoHint');
        if (hint) {
            hint.style.display = this.topoNodes.length === 0 ? 'flex' : 'none';
        }
    },

    // ══════════════════════════════════════════════════════════════════════
    //  SIDEBAR
    // ══════════════════════════════════════════════════════════════════════

    async _renderSidebar() {
        const container = document.getElementById('topoDeviceLibrary');
        if (!container) return;

        // Group devices by type
        const groups = {};
        const typeNames = {
            router: 'Routers',
            switch_: 'Switches',
            firewall: 'Firewalls',
            server_linux: 'Linux Servers',
            server_windows: 'Windows Servers',
            other: 'Other Devices',
        };

        for (const d of this.devices) {
            const t = d.device_type || 'other';
            if (!groups[t]) groups[t] = [];
            groups[t].push(d);
        }

        let html = '';
        for (const [type, devList] of Object.entries(groups)) {
            const typeLabel = typeNames[type] || type;
            const typeIcon = CONSTANTS.DEVICE_TYPES[type]?.icon || 'fa-question-circle';
            const typeColor = this._typeColors[type] || '#95a5a6';

            html += `<div class="topo-category">
                <div class="topo-category-title" style="color:${typeColor};">
                    <i class="fas ${typeIcon}"></i> ${typeLabel}
                    <span class="topo-category-count">${devList.length}</span>
                </div>`;

            for (const d of devList) {
                const statusColor = CONSTANTS.STATUS_COLORS[d.status] || '#95a5a6';
                const isOnMap = this.topoNodes.some(n => n.deviceId === d.id);
                html += `
                <div class="topo-device-item ${isOnMap ? 'on-map' : ''}"
                     draggable="true"
                     data-device-id="${d.id}"
                     data-device-type="${d.device_type || 'other'}"
                     data-device-name="${this._escAttr(d.name)}"
                     data-device-status="${d.status || 'unknown'}"
                     data-on-map="${isOnMap ? '1' : '0'}"
                     ondblclick="TopologyPage._navigateToDevice('${d.id}')">
                    <div class="topo-device-item-content">
                        <span class="topo-device-status-dot" style="background:${statusColor};" title="${d.status}"></span>
                        <span class="topo-device-item-name">${this._escHtml(d.name)}</span>
                    </div>
                    <span class="topo-device-item-ip">${d.ip_address || '-'}</span>
                    <button class="topo-device-add-btn ${isOnMap ? 'added' : ''}"
                            onclick="TopologyPage._addDeviceToCanvas('${d.id}')"
                            title="${isOnMap ? 'Already on map' : 'Add to map'}">
                        ${isOnMap ? '✓' : '+'}
                    </button>
                </div>`;
            }
            html += '</div>';
        }

        if (Object.keys(groups).length === 0) {
            html = '<div class="topo-loading" style="padding:20px;text-align:center;color:#999;">No managed devices found.<br>Add devices first via Discovery page.</div>';
        }

        container.innerHTML = html;

        // Setup drag events on sidebar items
        this._setupSidebarDragEvents();
    },

    _setupSidebarDragEvents() {
        const items = document.querySelectorAll('.topo-device-item[draggable="true"]');
        items.forEach(item => {
            item.addEventListener('dragstart', (e) => {
                const deviceId = item.dataset.deviceId;
                const deviceType = item.dataset.deviceType;
                const deviceName = item.dataset.deviceName;
                e.dataTransfer.setData('application/json', JSON.stringify({
                    type: 'nms-device',
                    deviceId: deviceId,
                    deviceType: deviceType,
                    deviceName: deviceName,
                }));
                e.dataTransfer.effectAllowed = 'copy';
                item.style.opacity = '0.5';
            });
            item.addEventListener('dragend', (e) => {
                item.style.opacity = '1';
            });
        });
    },

    // ══════════════════════════════════════════════════════════════════════
    //  CANVAS EVENTS
    // ══════════════════════════════════════════════════════════════════════

    _setupCanvasEvents() {
        if (!this.canvas) return;

        // Store bound handlers for cleanup
        this._boundMouseDown = this._onMouseDown.bind(this);
        this._boundMouseMove = this._onMouseMove.bind(this);
        this._boundMouseUp = this._onMouseUp.bind(this);
        this._boundWheel = this._onWheel.bind(this);
        this._boundDblClick = this._onDblClick.bind(this);
        this._boundContextMenu = this._onContextMenu.bind(this);
        this._boundDragOver = this._onDragOver.bind(this);
        this._boundDrop = this._onDrop.bind(this);

        this.canvas.addEventListener('mousedown', this._boundMouseDown);
        this.canvas.addEventListener('mousemove', this._boundMouseMove);
        this.canvas.addEventListener('mouseup', this._boundMouseUp);
        this.canvas.addEventListener('wheel', this._boundWheel, { passive: false });
        this.canvas.addEventListener('dblclick', this._boundDblClick);
        this.canvas.addEventListener('contextmenu', this._boundContextMenu);
        this.canvas.addEventListener('dragover', this._boundDragOver);
        this.canvas.addEventListener('drop', this._boundDrop);

        // Handle mouse leaving canvas
        this.canvas.addEventListener('mouseleave', () => {
            this.isPanning = false;
            this.draggingNode = null;
            this.isConnecting = false;
            this.connectSource = null;
        });
    },

    _setupGlobalEvents() {
        this._boundKeyDown = this._onKeyDown.bind(this);
        this._boundKeyUp = this._onKeyUp.bind(this);
        this._boundResize = this._onResize.bind(this);
        this._boundGlobalMouseUp = this._onGlobalMouseUp.bind(this);

        window.addEventListener('keydown', this._boundKeyDown);
        window.addEventListener('keyup', this._boundKeyUp);
        window.addEventListener('resize', this._boundResize);
        // Capture mouseup globally to handle releases outside canvas
        document.addEventListener('mouseup', this._boundGlobalMouseUp);
    },

    _teardownGlobalEvents() {
        if (this._boundKeyDown) window.removeEventListener('keydown', this._boundKeyDown);
        if (this._boundKeyUp) window.removeEventListener('keyup', this._boundKeyUp);
        if (this._boundResize) window.removeEventListener('resize', this._boundResize);
        if (this._boundGlobalMouseUp) document.removeEventListener('mouseup', this._boundGlobalMouseUp);
    },

    // ── Event handlers ───────────────────────────────────────────────────

    _onMouseDown(e) {
        this.lastMouseX = e.offsetX;
        this.lastMouseY = e.offsetY;

        // Space+drag or middle-mouse = pan
        if (this.spacePressed || e.button === 1) {
            this.isPanning = true;
            this.canvas.style.cursor = 'grabbing';
            return;
        }

        if (e.button !== 0) return;

        const worldPos = this._screenToWorld(e.offsetX, e.offsetY);

        // Check notes first (DOM elements overlay canvas)
        const note = this._getNoteAt(e.offsetX, e.offsetY);
        if (note) {
            this.selectedNote = note;
            this.selectedNode = null;
            this.selectedEdge = null;
            this.draggingNote = note;
            this._updateNoteElementSelection();
            this._draw();
            return;
        }

        // Check if clicking a connection line
        const edge = this._getEdgeAt(worldPos.x, worldPos.y);
        if (edge) {
            this.selectedEdge = edge;
            this.selectedNode = null;
            this._draw();
            return;
        }

        // Check if clicking a node
        const node = this._getNodeAt(worldPos.x, worldPos.y);
        if (node) {
            // Check if clicking near port border (connection mode)
            const edgeDist = this._distanceToEdge(worldPos.x, worldPos.y, node);
            if (edgeDist < 10 && !e.shiftKey) {
                // Start connection from this node
                this.isConnecting = true;
                this.connectSource = node;
                this.connectSourcePort = this._getClosestPort(worldPos.x, worldPos.y, node);
            } else {
                // Select and start dragging
                this.selectedNode = node;
                this.selectedEdge = null;
                this.draggingNode = node;
            }
        } else {
            // Click on empty canvas - pan
            this.isPanning = true;
            this.selectedNode = null;
            this.selectedEdge = null;
            this.canvas.style.cursor = 'grabbing';
        }

        this._draw();
    },

    _onMouseMove(e) {
        const dx = e.offsetX - this.lastMouseX;
        const dy = e.offsetY - this.lastMouseY;

        if (this.isPanning) {
            this.panX += dx;
            this.panY += dy;
            this._draw();
        } else if (this.draggingNode) {
            this.draggingNode.x += dx / this.scale;
            this.draggingNode.y += dy / this.scale;
            this._draw();
        } else if (this.isConnecting) {
            this._draw();
        } else if (this.draggingNote) {
            this.draggingNote.x += dx / this.scale;
            this.draggingNote.y += dy / this.scale;
            this._updateNotePosition(this.draggingNote);
        } else {
            // Update cursor based on what's under mouse
            const worldPos = this._screenToWorld(e.offsetX, e.offsetY);
            const node = this._getNodeAt(worldPos.x, worldPos.y);
            if (node) {
                const edgeDist = this._distanceToEdge(worldPos.x, worldPos.y, node);
                this.canvas.style.cursor = edgeDist < 10 ? 'crosshair' : 'move';
            } else {
                this.canvas.style.cursor = this.spacePressed ? 'grab' : 'default';
            }
        }

        this.lastMouseX = e.offsetX;
        this.lastMouseY = e.offsetY;
    },

    _onMouseUp(e) {
        if (this.isConnecting && this.connectSource) {
            const worldPos = this._screenToWorld(e.offsetX, e.offsetY);
            const targetNode = this._getNodeAt(worldPos.x, worldPos.y);

            if (targetNode && targetNode.id !== this.connectSource.id) {
                // Create connection via API
                this._createConnection(this.connectSource, targetNode);
            }

            this.isConnecting = false;
            this.connectSource = null;
            this.connectSourcePort = null;
            this._draw();
        }

        if (this.draggingNode) {
            // Save position
            this._saveNodePosition(this.draggingNode);
            this.draggingNode = null;
        }

        if (this.draggingNote) {
            this._saveNotesToBackend();
            this.draggingNote = null;
        }

        this.isPanning = false;
        this.canvas.style.cursor = 'default';
    },

    _onGlobalMouseUp(e) {
        // Handle mouseup outside canvas
        if (this.isPanning || this.draggingNode || this.isConnecting || this.draggingNote) {
            // Check if we're on a context menu - don't finalize if so
            const menu = document.getElementById('contextMenu');
            if (menu && menu.style.display === 'block') return;

            if (this.draggingNode) {
                this._saveNodePosition(this.draggingNode);
                this.draggingNode = null;
            }
            if (this.draggingNote) {
                this._saveNotesToBackend();
                this.draggingNote = null;
            }
            this.isPanning = false;
            this.isConnecting = false;
            this.connectSource = null;
            this.canvas.style.cursor = 'default';
        }
    },

    _onWheel(e) {
        e.preventDefault();

        const zoomFactor = 0.1;
        const mouseX = e.offsetX;
        const mouseY = e.offsetY;

        const worldX = (mouseX - this.panX) / this.scale;
        const worldY = (mouseY - this.panY) / this.scale;

        if (e.deltaY < 0) {
            this.scale *= (1 + zoomFactor);
        } else {
            this.scale /= (1 + zoomFactor);
        }

        this.scale = Math.min(Math.max(0.1, this.scale), 10);

        this.panX = mouseX - worldX * this.scale;
        this.panY = mouseY - worldY * this.scale;

        this._updateZoomDisplay();
        this._draw();
    },

    _onDblClick(e) {
        const worldPos = this._screenToWorld(e.offsetX, e.offsetY);
        const node = this._getNodeAt(worldPos.x, worldPos.y);
        if (node && node.deviceId) {
            App.navigateTo('devices/' + node.deviceId);
        } else if (node) {
            // Manual node: rename
            const newLabel = prompt('Edit label:', node.label);
            if (newLabel && newLabel !== node.label) {
                API.updateTopologyNode(node.id, { label: newLabel })
                    .then(() => {
                        node.label = newLabel;
                        this._draw();
                        App.toast('Label updated', 'success');
                    }).catch(e => App.toast('Error: ' + e.message, 'danger'));
            }
        }
    },

    _onContextMenu(e) {
        e.preventDefault();

        const worldPos = this._screenToWorld(e.offsetX, e.offsetY);

        // Check node
        const node = this._getNodeAt(worldPos.x, worldPos.y);
        if (node) {
            const menuType = node.device ? 'topology_device' : 'topology_manual';
            ContextMenu.show(e.clientX, e.clientY, menuType, {
                nodeId: node.id,
                node: node,
                device: node.device,
                page: 'topology',
                onUpdated: () => this._refreshAll(),
                onNodeUpdate: (id, updates) => {
                    const n = this.topoNodes.find(nd => nd.id === id);
                    if (n) {
                        if (updates.label) n.label = updates.label;
                        if (updates.canvas_data?.color) n.color = updates.canvas_data.color;
                        this._draw();
                    }
                },
            });
            return;
        }

        // Check edge
        const edge = this._getEdgeAt(worldPos.x, worldPos.y);
        if (edge) {
            ContextMenu.show(e.clientX, e.clientY, 'topology_edge', {
                edgeId: edge.id,
                edge: edge,
                onUpdated: () => this._refreshAll(),
                onEdgeUpdate: (id, updates) => {
                    const e = this.topoEdges.find(ed => ed.id === id);
                    if (e) {
                        if (updates.label !== undefined) e.label = updates.label;
                        if (updates.line_style) e.lineStyle = updates.line_style;
                        if (updates.dashes !== undefined) {
                            if (updates.dashes === false) e.lineStyle = 'solid';
                            else if (updates.dashes[0] === 2) e.lineStyle = 'dotted';
                            else e.lineStyle = 'dashed';
                        }
                        if (updates.hasOwnProperty('arrowEnabled')) e.arrowEnabled = updates.arrowEnabled;
                        this._draw();
                    }
                },
            });
            return;
        }
    },

    _onDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    },

    async _onDrop(e) {
        e.preventDefault();
        try {
            const data = JSON.parse(e.dataTransfer.getData('application/json'));
            if (data && data.type === 'nms-device') {
                const worldPos = this._screenToWorld(e.offsetX, e.offsetY);
                await this._addDeviceToCanvasAt(data.deviceId, worldPos.x - this.NODE_DEFAULTS.width / 2, worldPos.y - this.NODE_DEFAULTS.height / 2);
            }
        } catch (err) {
            console.error('Drop error:', err);
        }
    },

    _onKeyDown(e) {
        if (e.code === 'Space') {
            e.preventDefault();
            this.spacePressed = true;
            this.canvas.style.cursor = 'grab';
        }
        if (e.code === 'Delete' || e.code === 'Backspace') {
            // Don't delete when typing in input
            if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
            if (this.selectedNode) {
                this._deleteSelectedNode();
            } else if (this.selectedEdge) {
                this._deleteSelectedEdge();
            } else if (this.selectedNote) {
                this._deleteSelectedNote();
            }
        }
        if (e.code === 'Escape') {
            this.selectedNode = null;
            this.selectedEdge = null;
            this.selectedNote = null;
            this.isConnecting = false;
            this.connectSource = null;
            this._draw();
        }
    },

    _onKeyUp(e) {
        if (e.code === 'Space') {
            this.spacePressed = false;
            this.canvas.style.cursor = 'default';
        }
    },

    _onResize() {
        this._resizeCanvas();
        this._draw();
    },

    // ══════════════════════════════════════════════════════════════════════
    //  CANVAS DRAWING
    // ══════════════════════════════════════════════════════════════════════

    _draw() {
        if (!this.ctx || !this.canvas) return;

        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Clear
        ctx.clearRect(0, 0, w, h);

        // Background
        ctx.fillStyle = '#fafbfc';
        ctx.fillRect(0, 0, w, h);

        // Grid
        this._drawGrid(ctx, w, h);

        // Save and apply transform
        ctx.save();
        ctx.translate(this.panX, this.panY);
        ctx.scale(this.scale, this.scale);

        // Draw edges
        this._drawEdges(ctx);

        // Draw connecting line (if in progress)
        if (this.isConnecting && this.connectSource) {
            this._drawConnectingLine(ctx);
        }

        // Draw devices
        this._drawDevices(ctx);

        ctx.restore();

        // Draw notes (DOM-based, updated separately)
        this._renderNotes();

        // Update zoom display
        this._updateZoomDisplay();
    },

    _drawGrid(ctx, w, h) {
        const gs = this.GRID_SIZE * this.scale;
        if (gs < 4) return; // Too zoomed out for grid

        ctx.strokeStyle = 'rgba(200,200,200,0.15)';
        ctx.lineWidth = 0.5;

        const startX = this.panX % gs;
        const startY = this.panY % gs;

        ctx.beginPath();
        for (let x = startX; x < w; x += gs) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
        }
        for (let y = startY; y < h; y += gs) {
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
        }
        ctx.stroke();
    },

    _drawDevices(ctx) {
        for (const node of this.topoNodes) {
            const x = node.x;
            const y = node.y;
            const w = node.width;
            const h = node.height;
            const r = this.NODE_DEFAULTS.borderRadius;
            const isSelected = this.selectedNode && this.selectedNode.id === node.id;

            // Shadow
            ctx.shadowColor = 'rgba(0,0,0,0.08)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetX = 1;
            ctx.shadowOffsetY = 2;

            // Body
            ctx.beginPath();
            this._roundRect(ctx, x, y, w, h, r);
            ctx.fillStyle = '#ffffff';
            ctx.fill();

            // Reset shadow
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;

            // Border
            ctx.lineWidth = isSelected ? 3 : 2;
            ctx.strokeStyle = isSelected ? '#4361ee' : node.color;
            ctx.stroke();

            // Status indicator dot (top-left corner)
            ctx.beginPath();
            ctx.arc(x + 8, y + 8, 4, 0, Math.PI * 2);
            ctx.fillStyle = node.statusColor;
            ctx.fill();

            // Icon area (left portion of device)
            const iconAreaW = 36;
            ctx.fillStyle = this._lightenColor(node.color, 0.85);
            ctx.beginPath();
            this._roundRect(ctx, x + 2, y + 2, iconAreaW, h - 4, r - 2);
            ctx.fill();

            // Device type icon (emoji)
            ctx.font = '18px serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const icon = this._typeIcons[node.deviceType] || this._typeIcons.other;
            ctx.fillText(icon, x + 2 + iconAreaW / 2, y + h / 2);

            // Device name
            ctx.fillStyle = '#2c3e50';
            ctx.font = `bold ${this.NODE_DEFAULTS.nameFontSize}px "Segoe UI", "Microsoft YaHei", sans-serif`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            const nameX = x + iconAreaW + 8;
            const nameMaxW = w - iconAreaW - 16;
            const displayName = this._truncateText(ctx, node.label, nameMaxW);
            ctx.fillText(displayName, nameX, y + 8);

            // Device type label
            ctx.fillStyle = '#7f8c8d';
            ctx.font = '10px "Segoe UI", "Microsoft YaHei", sans-serif';
            const typeLabel = (CONSTANTS.DEVICE_TYPES[node.deviceType]?.label) || 'Device';
            ctx.fillText(typeLabel, nameX, y + 26);

            // IP address if available
            if (node.device && node.device.ip_address) {
                ctx.fillStyle = '#95a5a6';
                ctx.font = '9px monospace';
                ctx.fillText(node.device.ip_address, nameX, y + 42);
            }

            // Port indicators along the edges
            this._drawPortIndicators(ctx, node);

            // Port count badge
            const portCount = node.ports.length;
            if (portCount > 0) {
                const badgeW = Math.max(22, ctx.measureText(portCount + 'p').width + 8);
                ctx.fillStyle = node.color;
                ctx.beginPath();
                this._roundRect(ctx, x + w - badgeW - 4, y + h - 14, badgeW, 12, 6);
                ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.font = '8px "Segoe UI", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(portCount + 'p', x + w - badgeW / 2 - 4, y + h - 8);
            }
        }
    },

    _drawPortIndicators(ctx, node) {
        const ports = node.ports;
        if (!ports || ports.length === 0) return;

        const x = node.x;
        const y = node.y;
        const w = node.width;
        const h = node.height;

        // Decide which side to show ports based on device connections
        // Default: left side for source ports, right side for others
        // We'll show connected ports more prominently
        const showAll = ports.length <= 24;

        if (!showAll) {
            // Only show connected ports
            const connected = ports.filter(p => p.connected);
            const spacing = Math.min(8, h / (connected.length + 1));
            connected.forEach((port, i) => {
                const py = y + spacing * (i + 1);
                ctx.beginPath();
                ctx.arc(x, py, 3, 0, Math.PI * 2);
                ctx.fillStyle = '#2ecc71';
                ctx.fill();
            });
            return;
        }

        // Show ports on left and right edges
        const maxPerSide = Math.min(ports.length, 12);
        const spacing = h / (maxPerSide + 1);

        for (let i = 0; i < Math.min(maxPerSide, ports.length); i++) {
            const port = ports[i];
            const py = y + spacing * (i + 1);
            const isConnected = this._isPortConnected(node.id, port.id);

            // Left side port
            ctx.beginPath();
            ctx.arc(x, py, this.NODE_DEFAULTS.portRadius, 0, Math.PI * 2);
            ctx.fillStyle = isConnected ? '#2ecc71' : '#d1d5db';
            ctx.fill();
            ctx.strokeStyle = isConnected ? '#27ae60' : '#bbb';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    },

    _isPortConnected(nodeId, portId) {
        return this.topoEdges.some(e =>
            (e.sourceNodeId === nodeId && e.sourceInterface === portId) ||
            (e.targetNodeId === nodeId && e.targetInterface === portId)
        );
    },

    _drawEdges(ctx) {
        for (const edge of this.topoEdges) {
            const srcNode = this.topoNodes.find(n => n.id === edge.sourceNodeId);
            const tgtNode = this.topoNodes.find(n => n.id === edge.targetNodeId);
            if (!srcNode || !tgtNode) continue;

            const isSelected = this.selectedEdge && this.selectedEdge.id === edge.id;

            // Calculate connection points
            const srcPt = this._getConnectionPoint(srcNode, tgtNode);
            const tgtPt = this._getConnectionPoint(tgtNode, srcNode);

            // Save sides for API
            edge.sourceSide = srcPt.side;
            edge.targetSide = tgtPt.side;

            // Line style
            const dashPattern = edge.lineStyle === 'dashed' ? [8, 4] :
                               edge.lineStyle === 'dotted' ? [2, 4] : [];

            ctx.beginPath();
            ctx.moveTo(srcPt.x, srcPt.y);

            // Bezier curve
            const dx = tgtPt.x - srcPt.x;
            const dy = tgtPt.y - srcPt.y;

            if (Math.abs(dx) > Math.abs(dy)) {
                const midX = (srcPt.x + tgtPt.x) / 2;
                ctx.bezierCurveTo(midX, srcPt.y, midX, tgtPt.y, tgtPt.x, tgtPt.y);
            } else {
                const midY = (srcPt.y + tgtPt.y) / 2;
                ctx.bezierCurveTo(srcPt.x, midY, tgtPt.x, midY, tgtPt.x, tgtPt.y);
            }

            ctx.strokeStyle = isSelected ? '#4361ee' : (edge.color || '#8899aa');
            ctx.lineWidth = isSelected ? 3 : 2;
            if (dashPattern.length > 0) {
                ctx.setLineDash(dashPattern);
            }
            ctx.stroke();
            ctx.setLineDash([]);

            // Arrow only if explicitly enabled
            if (edge.arrowEnabled) {
                this._drawArrow(ctx, tgtPt, srcPt, isSelected ? '#4361ee' : (edge.color || '#8899aa'));
            }

            // Label at midpoint
            if (edge.label) {
                const midX = (srcPt.x + tgtPt.x) / 2 + (edge.labelOffsetX || 0) / this.scale;
                const midY = (srcPt.y + tgtPt.y) / 2 + (edge.labelOffsetY || 0) / this.scale - 8;

                // Background for label
                const labelW = ctx.measureText(edge.label).width + 8;
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.fillRect(midX - labelW / 2, midY - 7, labelW, 14);

                ctx.fillStyle = '#2c3e50';
                ctx.font = '10px "Segoe UI", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(edge.label, midX, midY);
            }
        }
    },

    _drawArrow(ctx, toPoint, fromPoint, color) {
        const angle = Math.atan2(toPoint.y - fromPoint.y, toPoint.x - fromPoint.x);
        const arrowSize = 10;

        // Arrowhead at the edge of target device
        const tipX = toPoint.x - Math.cos(angle) * (this.NODE_DEFAULTS.borderRadius + 3);
        const tipY = toPoint.y - Math.sin(angle) * (this.NODE_DEFAULTS.borderRadius + 3);

        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(
            tipX - arrowSize * Math.cos(angle - Math.PI / 6),
            tipY - arrowSize * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
            tipX - arrowSize * Math.cos(angle + Math.PI / 6),
            tipY - arrowSize * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fillStyle = color || '#8899aa';
        ctx.fill();
        ctx.strokeStyle = color || '#8899aa';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    },

    _drawConnectingLine(ctx) {
        const srcNode = this.connectSource;
        const srcPt = this._getConnectionPoint(srcNode, { x: this.lastMouseX, y: this.lastMouseY, width: 0, height: 0 });

        const mouseWorldX = (this.lastMouseX - this.panX) / this.scale;
        const mouseWorldY = (this.lastMouseY - this.panY) / this.scale;

        ctx.beginPath();
        ctx.moveTo(srcPt.x, srcPt.y);
        ctx.lineTo(mouseWorldX, mouseWorldY);
        ctx.strokeStyle = '#e74c3c';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
    },

    // ── Hit testing ──────────────────────────────────────────────────────

    _screenToWorld(sx, sy) {
        return {
            x: (sx - this.panX) / this.scale,
            y: (sy - this.panY) / this.scale,
        };
    },

    _getNodeAt(wx, wy) {
        for (let i = this.topoNodes.length - 1; i >= 0; i--) {
            const n = this.topoNodes[i];
            if (wx >= n.x && wx <= n.x + n.width && wy >= n.y && wy <= n.y + n.height) {
                return n;
            }
        }
        return null;
    },

    _getEdgeAt(wx, wy) {
        const threshold = 8 / this.scale;
        for (const edge of this.topoEdges) {
            const src = this.topoNodes.find(n => n.id === edge.sourceNodeId);
            const tgt = this.topoNodes.find(n => n.id === edge.targetNodeId);
            if (!src || !tgt) continue;

            const srcPt = this._getConnectionPoint(src, tgt);
            const tgtPt = this._getConnectionPoint(tgt, src);

            // Sample points along bezier curve and check distance
            const dist = this._distanceToBezier(wx, wy, srcPt, tgtPt);
            if (dist < threshold) return edge;
        }
        return null;
    },

    _distanceToBezier(px, py, p0, p1) {
        // Approximate bezier by sampling
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        let minDist = Infinity;

        for (let t = 0; t <= 1; t += 0.05) {
            let bx, by;
            if (Math.abs(dx) > Math.abs(dy)) {
                const midX = (p0.x + p1.x) / 2;
                bx = Math.pow(1 - t, 3) * p0.x + 3 * Math.pow(1 - t, 2) * t * midX + 3 * (1 - t) * Math.pow(t, 2) * midX + Math.pow(t, 3) * p1.x;
                by = Math.pow(1 - t, 3) * p0.y + 3 * Math.pow(1 - t, 2) * t * p0.y + 3 * (1 - t) * Math.pow(t, 2) * p1.y + Math.pow(t, 3) * p1.y;
            } else {
                const midY = (p0.y + p1.y) / 2;
                bx = Math.pow(1 - t, 3) * p0.x + 3 * Math.pow(1 - t, 2) * t * p0.x + 3 * (1 - t) * Math.pow(t, 2) * p1.x + Math.pow(t, 3) * p1.x;
                by = Math.pow(1 - t, 3) * p0.y + 3 * Math.pow(1 - t, 2) * t * midY + 3 * (1 - t) * Math.pow(t, 2) * midY + Math.pow(t, 3) * p1.y;
            }
            const d = Math.sqrt((bx - px) ** 2 + (by - py) ** 2);
            if (d < minDist) minDist = d;
        }
        return minDist;
    },

    _distanceToEdge(wx, wy, node) {
        const x = node.x, y = node.y, w = node.width, h = node.height;
        let minDist = Infinity;

        // Distance to each edge
        if (wy >= y && wy <= y + h) {
            minDist = Math.min(minDist, Math.abs(wx - x), Math.abs(wx - (x + w)));
        }
        if (wx >= x && wx <= x + w) {
            minDist = Math.min(minDist, Math.abs(wy - y), Math.abs(wy - (y + h)));
        }

        return minDist;
    },

    _getClosestPort(wx, wy, node) {
        const ports = node.ports;
        if (!ports || ports.length === 0) return null;

        // Simple: return the port closest to the click point on the left edge
        const spacing = node.height / (Math.min(ports.length, 12) + 1);
        let closestPort = null;
        let closestDist = Infinity;

        for (let i = 0; i < Math.min(ports.length, 12); i++) {
            const py = node.y + spacing * (i + 1);
            const dist = Math.abs(wy - py);
            if (dist < closestDist && dist < spacing) {
                closestDist = dist;
                closestPort = ports[i];
            }
        }
        return closestPort;
    },

    _getConnectionPoint(node, targetNode) {
        const cx = node.x + node.width / 2;
        const cy = node.y + node.height / 2;
        const tcx = targetNode.x + (targetNode.width || 0) / 2;
        const tcy = targetNode.y + (targetNode.height || 0) / 2;

        const dx = tcx - cx;
        const dy = tcy - cy;

        let side, x, y;
        if (Math.abs(dx) > Math.abs(dy)) {
            if (dx > 0) {
                side = 'right';
                x = node.x + node.width;
                y = cy;
            } else {
                side = 'left';
                x = node.x;
                y = cy;
            }
        } else {
            if (dy > 0) {
                side = 'bottom';
                x = cx;
                y = node.y + node.height;
            } else {
                side = 'top';
                x = cx;
                y = node.y;
            }
        }
        return { x, y, side };
    },

    // ── Notes (canvas text annotations) ──────────────────────────────────

    _renderNotes() {
        // Remove existing note elements
        document.querySelectorAll('.topo-canvas-note').forEach(el => el.remove());

        const wrap = document.getElementById('topoCanvasWrap');
        if (!wrap) return;

        for (const note of this.topoNotes) {
            const el = document.createElement('div');
            el.className = 'topo-canvas-note' + (this.selectedNote && this.selectedNote.id === note.id ? ' selected' : '');
            el.textContent = note.content;
            el.style.left = (note.x * this.scale + this.panX) + 'px';
            el.style.top = (note.y * this.scale + this.panY) + 'px';
            el.style.width = (note.width || 200) + 'px';
            el.style.minHeight = (note.height || 60) + 'px';
            el.dataset.noteId = note.id;

            // Events
            el.addEventListener('mousedown', (ev) => {
                if (ev.button === 0) {
                    this.selectedNote = note;
                    this.selectedNode = null;
                    this.selectedEdge = null;
                    this._updateNoteElementSelection();
                    this.draggingNote = note;
                    const rect = this.canvas.getBoundingClientRect();
                    this.lastMouseX = ev.clientX - rect.left;
                    this.lastMouseY = ev.clientY - rect.top;
                    this._draw();
                }
                ev.stopPropagation();
            });

            el.addEventListener('dblclick', (ev) => {
                ev.stopPropagation();
                this._editNoteContent(note);
            });

            el.addEventListener('contextmenu', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                this.selectedNote = note;
                this._updateNoteElementSelection();
                ContextMenu.show(ev.clientX, ev.clientY, 'topology_note', {
                    note,
                    onUpdated: () => this._refreshAll(),
                    onEdit: () => this._editNoteContent(note),
                    onDelete: () => this._deleteNoteById(note.id),
                });
            });

            wrap.appendChild(el);
        }
    },

    _updateNoteElementSelection() {
        document.querySelectorAll('.topo-canvas-note').forEach(el => {
            el.classList.toggle('selected',
                this.selectedNote && el.dataset.noteId === this.selectedNote.id);
        });
    },

    _updateNotePosition(note) {
        const el = document.querySelector(`.topo-canvas-note[data-note-id="${note.id}"]`);
        if (el) {
            el.style.left = (note.x * this.scale + this.panX) + 'px';
            el.style.top = (note.y * this.scale + this.panY) + 'px';
        }
    },

    _getNoteAt(sx, sy) {
        for (let i = this.topoNotes.length - 1; i >= 0; i--) {
            const n = this.topoNotes[i];
            const nx = n.x * this.scale + this.panX;
            const ny = n.y * this.scale + this.panY;
            const nw = (n.width || 200);
            const nh = (n.height || 60);
            if (sx >= nx && sx <= nx + nw && sy >= ny && sy <= ny + nh) {
                return n;
            }
        }
        return null;
    },

    _editNoteContent(note) {
        const newContent = prompt(note.content ? 'Edit text:' : 'Add text:', note.content || '');
        if (newContent !== null && newContent !== note.content) {
            note.content = newContent;
            this._renderNotes();
            this._saveNotesToBackend();
        }
    },

    _deleteNoteById(noteId) {
        this.topoNotes = this.topoNotes.filter(n => n.id !== noteId);
        if (this.selectedNote && this.selectedNote.id === noteId) {
            this.selectedNote = null;
        }
        this._renderNotes();
        this._saveNotesToBackend();
    },

    async _saveNotesToBackend() {
        // Save notes as canvas_data on the first topology node (or a dedicated notes node)
        if (this.topoNodes.length === 0) return;

        const notesData = this.topoNotes.map(n => ({
            id: n.id,
            content: n.content,
            x: n.x,
            y: n.y,
            width: n.width,
            height: n.height,
        }));

        // Save notes on first node's canvas_data
        const firstNode = this.topoNodes[0];
        const cd = firstNode.canvasData || {};
        cd.notes = notesData;
        cd.view = { scale: this.scale, panX: this.panX, panY: this.panY };

        try {
            await API.updateTopologyNode(firstNode.id, { canvas_data: cd });
        } catch (e) {
            // Silent fail for notes
        }
    },

    // ── Utility drawing helpers ──────────────────────────────────────────

    _roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
    },

    _truncateText(ctx, text, maxWidth) {
        if (ctx.measureText(text).width <= maxWidth) return text;
        let truncated = text;
        while (ctx.measureText(truncated + '...').width > maxWidth && truncated.length > 0) {
            truncated = truncated.slice(0, -1);
        }
        return truncated + '...';
    },

    _lightenColor(hex, factor) {
        if (!hex || hex === '#ffffff') return '#ffffff';
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const lr = Math.round(r + (255 - r) * factor);
        const lg = Math.round(g + (255 - g) * factor);
        const lb = Math.round(b + (255 - b) * factor);
        return `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
    },

    _escHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    _escAttr(str) {
        return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    _resizeCanvas() {
        if (!this.canvas) return;
        const container = document.getElementById('topoCanvasWrap');
        if (container) {
            const rect = container.getBoundingClientRect();
            this.canvas.width = rect.width || container.clientWidth || 800;
            this.canvas.height = rect.height || container.clientHeight || 600;
        }
    },

    _updateZoomDisplay() {
        const el = document.getElementById('topoZoomDisplay');
        if (el) {
            el.textContent = Math.round(this.scale * 100) + '%';
        }
    },

    // ══════════════════════════════════════════════════════════════════════
    //  ACTION METHODS (called from onClick handlers)
    // ══════════════════════════════════════════════════════════════════════

    async _addDeviceToCanvas(deviceId) {
        const device = this.devices.find(d => d.id === deviceId);
        if (!device) {
            App.toast('Device not found', 'warning');
            return;
        }

        // Check if already on map
        if (this.topoNodes.some(n => n.deviceId === deviceId)) {
            App.toast('Device already on map', 'info');
            return;
        }

        // Calculate position (center of viewport)
        const cx = (this.canvas.width / 2 - this.panX) / this.scale - this.NODE_DEFAULTS.width / 2;
        const cy = (this.canvas.height / 2 - this.panY) / this.scale - this.NODE_DEFAULTS.height / 2;

        await this._addDeviceToCanvasAt(deviceId, cx, cy);
    },

    async _addDeviceToCanvasAt(deviceId, x, y) {
        const device = this.devices.find(d => d.id === deviceId);
        if (!device) return;

        // Check if already on map
        if (this.topoNodes.some(n => n.deviceId === deviceId)) {
            App.toast('Device already on map', 'info');
            return;
        }

        try {
            const res = await API.addTopologyNode({
                device_id: deviceId,
                label: device.name,
                node_type: 'device',
                x: Math.round(x),
                y: Math.round(y),
                canvas_data: { color: this._typeColors[device.device_type] || '#4361ee' },
            });

            // Add to local data
            const cd = res.canvas_data || {};
            this.topoNodes.push({
                id: res.id,
                label: device.name,
                deviceId: deviceId,
                nodeType: 'device',
                x: Math.round(x),
                y: Math.round(y),
                width: this.NODE_DEFAULTS.width,
                height: this.NODE_DEFAULTS.height,
                color: this._typeColors[device.device_type] || '#4361ee',
                statusColor: CONSTANTS.STATUS_COLORS[device.status] || '#95a5a6',
                deviceType: device.device_type || 'other',
                device: device,
                ports: this._generateSimplePorts(device.interfaces_count || 8, device.device_type || 'other'),
                notes: [],
                discoverySource: null,
            });

            this._draw();
            this._updateHint();
            await this._renderSidebar(); // Refresh sidebar to show "on map" status
            App.toast('Device added: ' + device.name, 'success');
        } catch (e) {
            App.toast('Error adding device: ' + e.message, 'danger');
        }
    },

    async _createConnection(srcNode, tgtNode) {
        try {
            const srcPort = this.connectSourcePort ? this.connectSourcePort.id : 'port-1';
            // Find free port on target
            const tgtPortObj = tgtNode.ports.find(p => !this._isPortConnected(tgtNode.id, p.id));
            const tgtPort = tgtPortObj ? tgtPortObj.id : 'port-1';

            const res = await API.addTopologyEdge({
                source_node_id: srcNode.id,
                target_node_id: tgtNode.id,
                source_interface: srcPort,
                target_interface: tgtPort,
                label: '',
                line_style: 'solid',
                color: '#8899aa',
                canvas_data: {},
            });

            this.topoEdges.push({
                id: res.id,
                sourceNodeId: srcNode.id,
                targetNodeId: tgtNode.id,
                label: '',
                sourceInterface: srcPort,
                targetInterface: tgtPort,
                lineStyle: 'solid',
                color: '#8899aa',
                labelOffsetX: 0,
                labelOffsetY: 0,
                sourceSide: null,
                targetSide: null,
            });

            // Mark ports as connected
            const sp = srcNode.ports.find(p => p.id === srcPort);
            if (sp) sp.connected = true;
            const tp = tgtNode.ports.find(p => p.id === tgtPort);
            if (tp) tp.connected = true;

            this._draw();
            App.toast('Connection created', 'success');
        } catch (e) {
            App.toast('Error creating connection: ' + e.message, 'danger');
        }
    },

    async _navigateToDevice(deviceId) {
        App.navigateTo('devices/' + deviceId);
    },

    async _saveNodePosition(node) {
        try {
            await API.updateTopologyNode(node.id, {
                x: Math.round(node.x),
                y: Math.round(node.y),
            });
        } catch (e) {
            // Silent save
        }
    },

    async _deleteSelectedNode() {
        if (!this.selectedNode) return;
        if (!confirm(`Delete "${this.selectedNode.label}" and all its connections?`)) return;

        const nodeId = this.selectedNode.id;
        try {
            await API.deleteTopologyNode(nodeId);
            this.topoNodes = this.topoNodes.filter(n => n.id !== nodeId);
            this.topoEdges = this.topoEdges.filter(e =>
                e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId
            );
            this.selectedNode = null;
            this._draw();
            this._updateHint();
            await this._renderSidebar();
            App.toast('Node deleted', 'info');
        } catch (e) {
            App.toast('Error deleting node: ' + e.message, 'danger');
        }
    },

    async _deleteSelectedEdge() {
        if (!this.selectedEdge) return;
        if (!confirm('Delete this connection?')) return;

        const edgeId = this.selectedEdge.id;
        try {
            await API.deleteTopologyEdge(edgeId);
            this.topoEdges = this.topoEdges.filter(e => e.id !== edgeId);
            this.selectedEdge = null;
            this._draw();
            App.toast('Connection deleted', 'info');
        } catch (e) {
            App.toast('Error deleting connection: ' + e.message, 'danger');
        }
    },

    _deleteSelectedNote() {
        if (!this.selectedNote) return;
        this._deleteNoteById(this.selectedNote.id);
    },

    _addNote() {
        const content = prompt('Enter note text:');
        if (!content || !content.trim()) return;

        const cx = (this.canvas.width / 2 - this.panX) / this.scale;
        const cy = (this.canvas.height / 2 - this.panY) / this.scale;

        const note = {
            id: 'note-' + Date.now() + Math.random().toString(36).substr(2, 9),
            content: content.trim(),
            x: cx - 100,
            y: cy - 30,
            width: 200,
            height: 60,
        };

        this.topoNotes.push(note);
        this._renderNotes();
        this._saveNotesToBackend();
        App.toast('Note added', 'success');
    },

    async _refreshAll() {
        try {
            const [topology, devices] = await Promise.all([
                API.getTopology(),
                API.getDevices(),
            ]);
            this.devices = devices;
            this._buildNodes(topology.nodes, topology.edges, devices);
            this._updateHint();
            this._draw();
            await this._renderSidebar();
        } catch (e) {
            App.toast('Refresh failed: ' + e.message, 'danger');
        }
    },

    _zoomIn() {
        this.scale = Math.min(10, this.scale * 1.2);
        this._updateZoomDisplay();
        this._draw();
    },

    _zoomOut() {
        this.scale = Math.max(0.1, this.scale / 1.2);
        this._updateZoomDisplay();
        this._draw();
    },

    _fitAll() {
        if (this.topoNodes.length === 0) {
            this.scale = 1;
            this.panX = 0;
            this.panY = 0;
            this._draw();
            return;
        }

        // Calculate bounds
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of this.topoNodes) {
            if (n.x < minX) minX = n.x;
            if (n.y < minY) minY = n.y;
            if (n.x + n.width > maxX) maxX = n.x + n.width;
            if (n.y + n.height > maxY) maxY = n.y + n.height;
        }

        const padding = 50;
        const contentW = maxX - minX + padding * 2;
        const contentH = maxY - minY + padding * 2;

        const canvasW = this.canvas.width;
        const canvasH = this.canvas.height;

        const scaleX = canvasW / contentW;
        const scaleY = canvasH / contentH;
        this.scale = Math.min(scaleX, scaleY, 1.5);

        // Center
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        this.panX = canvasW / 2 - centerX * this.scale;
        this.panY = canvasH / 2 - centerY * this.scale;

        this._updateZoomDisplay();
        this._draw();
    },

    async _runAutoDiscovery() {
        try {
            await API.runTopologyDiscovery();
            App.toast('Topology discovery started. Map will update shortly.', 'info');
            setTimeout(() => this._refreshAll(), 5000);
        } catch (e) {
            App.toast('Discovery failed: ' + e.message, 'danger');
        }
    },

    // ── Export / Import ──────────────────────────────────────────────────

    _exportTopology() {
        const data = {
            version: '2.0',
            exportedAt: new Date().toISOString(),
            nodes: this.topoNodes.map(n => ({
                id: n.id,
                label: n.label,
                deviceId: n.deviceId,
                nodeType: n.nodeType,
                x: n.x,
                y: n.y,
                width: n.width,
                height: n.height,
                color: n.color,
                deviceType: n.deviceType,
                device: n.device ? {
                    id: n.device.id,
                    name: n.device.name,
                    ip_address: n.device.ip_address,
                    device_type: n.device.device_type,
                    status: n.device.status,
                } : null,
            })),
            edges: this.topoEdges.map(e => ({
                id: e.id,
                sourceNodeId: e.sourceNodeId,
                targetNodeId: e.targetNodeId,
                label: e.label,
                sourceInterface: e.sourceInterface,
                targetInterface: e.targetInterface,
                lineStyle: e.lineStyle,
                color: e.color,
            })),
            notes: this.topoNotes.map(n => ({
                id: n.id,
                content: n.content,
                x: n.x,
                y: n.y,
                width: n.width,
                height: n.height,
            })),
            view: {
                scale: this.scale,
                panX: this.panX,
                panY: this.panY,
            },
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `topology_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        App.toast('Topology exported', 'success');
    },

    _triggerImport() {
        document.getElementById('topoFileInput').click();
    },

    async _handleImportFile(input) {
        const file = input.files[0];
        if (!file) return;
        input.value = '';

        try {
            const text = await file.text();
            const data = JSON.parse(text);

            if (!data.nodes || !data.edges) {
                throw new Error('Invalid topology file format');
            }

            // Clear current canvas
            this.topoNodes = [];
            this.topoEdges = [];
            this.topoNotes = data.notes || [];
            this.selectedNode = null;
            this.selectedEdge = null;

            // Import nodes
            for (const nodeData of data.nodes) {
                const device = this.devices.find(d => d.id === nodeData.deviceId);
                try {
                    const res = await API.addTopologyNode({
                        device_id: nodeData.deviceId || null,
                        label: nodeData.label,
                        node_type: nodeData.nodeType || 'device',
                        x: Math.round(nodeData.x),
                        y: Math.round(nodeData.y),
                        canvas_data: {
                            color: nodeData.color,
                            width: nodeData.width,
                            height: nodeData.height,
                            notes: data.notes || [],
                        },
                    });

                    this.topoNodes.push({
                        id: res.id,
                        label: nodeData.label,
                        deviceId: nodeData.deviceId || null,
                        nodeType: nodeData.nodeType || 'device',
                        x: nodeData.x,
                        y: nodeData.y,
                        width: nodeData.width || this.NODE_DEFAULTS.width,
                        height: nodeData.height || this.NODE_DEFAULTS.height,
                        color: nodeData.color || '#4361ee',
                        statusColor: device ? (CONSTANTS.STATUS_COLORS[device.status] || '#95a5a6') : '#95a5a6',
                        deviceType: nodeData.deviceType || 'other',
                        device: device,
                        ports: this._generateSimplePorts(device?.interfaces_count || 8, nodeData.deviceType || 'other'),
                        notes: [],
                        discoverySource: 'import',
                    });
                } catch (e) {
                    console.error('Failed to import node:', e);
                }
            }

            // Import edges
            const nodeIdMap = {}; // Map old IDs to new
            for (let i = 0; i < Math.min(data.nodes.length, this.topoNodes.length); i++) {
                nodeIdMap[data.nodes[i].id] = this.topoNodes[i].id;
            }

            for (const edgeData of data.edges) {
                const srcId = nodeIdMap[edgeData.sourceNodeId];
                const tgtId = nodeIdMap[edgeData.targetNodeId];
                if (!srcId || !tgtId) continue;

                try {
                    const res = await API.addTopologyEdge({
                        source_node_id: srcId,
                        target_node_id: tgtId,
                        label: edgeData.label || '',
                        source_interface: edgeData.sourceInterface || '',
                        target_interface: edgeData.targetInterface || '',
                        line_style: edgeData.lineStyle || 'solid',
                        color: edgeData.color || '#8899aa',
                        canvas_data: {},
                    });

                    this.topoEdges.push({
                        id: res.id,
                        sourceNodeId: srcId,
                        targetNodeId: tgtId,
                        label: edgeData.label || '',
                        sourceInterface: edgeData.sourceInterface || '',
                        targetInterface: edgeData.targetInterface || '',
                        lineStyle: edgeData.lineStyle || 'solid',
                        color: edgeData.color || '#8899aa',
                        labelOffsetX: 0,
                        labelOffsetY: 0,
                        sourceSide: null,
                        targetSide: null,
                    });
                } catch (e) {
                    console.error('Failed to import edge:', e);
                }
            }

            // Restore view
            if (data.view) {
                this.scale = data.view.scale || 1;
                this.panX = data.view.panX || 0;
                this.panY = data.view.panY || 0;
            }

            this._draw();
            this._updateHint();
            await this._renderSidebar();
            App.toast('Topology imported successfully', 'success');
        } catch (e) {
            App.toast('Import failed: ' + e.message, 'danger');
        }
    },
};
