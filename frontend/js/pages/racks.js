/**
 * Racks Page — rack management with device placement visualization.
 */
const RacksPage = {
    racks: [],

    async render() {
        const container = document.getElementById('pageContainer');
        container.innerHTML = `
            <div class="page-header">
                <h2><i class="fas fa-grip-vertical"></i> Rack View</h2>
                <button class="btn btn-primary" onclick="RacksPage.showAddRackModal()">
                    <i class="fas fa-plus"></i> Add Rack
                </button>
            </div>
            <div class="rack-grid" id="rackGrid">
                <div class="spinner"></div>
            </div>
        `;

        await this.loadRacks();
    },

    destroy() {},

    async loadRacks() {
        const grid = document.getElementById('rackGrid');
        if (!grid) return;

        try {
            this.racks = await API.getRacks();

            if (this.racks.length === 0) {
                grid.innerHTML = `
                    <div class="empty-state" style="grid-column:1/-1;">
                        <i class="fas fa-grip-vertical" style="font-size:48px;color:#ccc;margin-bottom:15px;display:block;"></i>
                        <p>No racks configured. Click "Add Rack" to create one.</p>
                    </div>`;
                return;
            }

            grid.innerHTML = this.racks.map(rack => `
                <div class="card rack-card">
                    <div class="card-header">
                        <h4>${Format.esc(rack.name)}</h4>
                        <div>
                            <button class="btn btn-sm" onclick="RacksPage.showRackDetail('${rack.id}')"
                                    title="View Details"><i class="fas fa-eye"></i></button>
                            <button class="btn btn-sm" onclick="RacksPage.editRack('${rack.id}')"
                                    title="Edit"><i class="fas fa-edit"></i></button>
                            <button class="btn btn-sm btn-danger" onclick="RacksPage.deleteRack('${rack.id}')"
                                    title="Delete"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                    <div class="rack-preview" id="rackPreview-${rack.id}">
                        <div class="spinner" style="min-height:200px;"></div>
                    </div>
                    <div class="rack-info">
                        <span>${rack.height}U Rack</span>
                        ${rack.location ? `<span>📍 ${Format.esc(rack.location)}</span>` : ''}
                        <span>${rack.device_count} device(s)</span>
                    </div>
                </div>
            `).join('');

            // Load each rack preview
            for (const rack of this.racks) {
                this._renderRackPreview(rack.id);
            }

        } catch (e) {
            grid.innerHTML = `<p class="error-text">Failed to load racks: ${e.message}</p>`;
        }
    },

    async _renderRackPreview(rackId) {
        const preview = document.getElementById(`rackPreview-${rackId}`);
        if (!preview) return;

        try {
            const devices = await API.getRackDevices(rackId);
            const rack = this.racks.find(r => r.id === rackId);
            if (!rack) return;

            preview.innerHTML = RackView.renderStatic(rack.height, devices, rack.width);
        } catch (e) {
            preview.innerHTML = `<p class="error-text">${e.message}</p>`;
        }
    },

    showAddRackModal() {
        App.showModal('Add Rack', `
            <div class="form-group">
                <label>Rack Name</label>
                <input type="text" id="rackName" class="form-input" placeholder="e.g. Data Center Rack A1">
            </div>
            <div class="form-group">
                <label>Location</label>
                <input type="text" id="rackLocation" class="form-input" placeholder="e.g. Floor 1, Room 101">
            </div>
            <div class="form-group">
                <label>Height (RU)</label>
                <input type="number" id="rackHeight" class="form-input" value="42" min="1" max="60">
            </div>
            <div class="form-group">
                <label>Width (inches)</label>
                <input type="number" id="rackWidth" class="form-input" value="19" min="10" max="30">
            </div>
        `, async (box) => {
            const data = {
                name: box.querySelector('#rackName').value,
                location: box.querySelector('#rackLocation').value || null,
                height: parseInt(box.querySelector('#rackHeight').value) || 42,
                width: parseInt(box.querySelector('#rackWidth').value) || 19,
            };
            if (!data.name) throw new Error('Rack name is required');
            await API.createRack(data);
            App.toast('Rack created', 'success');
            await this.loadRacks();
        });
    },

    async editRack(rackId) {
        const rack = this.racks.find(r => r.id === rackId);
        if (!rack) return;

        App.showModal('Edit Rack', `
            <div class="form-group">
                <label>Rack Name</label>
                <input type="text" id="rackName" class="form-input" value="${Format.esc(rack.name)}">
            </div>
            <div class="form-group">
                <label>Location</label>
                <input type="text" id="rackLocation" class="form-input" value="${Format.esc(rack.location || '')}">
            </div>
            <div class="form-group">
                <label>Height (RU)</label>
                <input type="number" id="rackHeight" class="form-input" value="${rack.height}" min="1">
            </div>
        `, async (box) => {
            await API.updateRack(rackId, {
                name: box.querySelector('#rackName').value,
                location: box.querySelector('#rackLocation').value || null,
                height: parseInt(box.querySelector('#rackHeight').value),
            });
            App.toast('Rack updated', 'success');
            await this.loadRacks();
        });
    },

    async deleteRack(rackId) {
        if (!confirm('Delete this rack? All device placements will be removed.')) return;
        try {
            await API.deleteRack(rackId);
            App.toast('Rack deleted', 'info');
            await this.loadRacks();
        } catch (e) {
            App.toast('Failed to delete rack: ' + e.message, 'danger');
        }
    },

    async showRackDetail(rackId) {
        const rack = this.racks.find(r => r.id === rackId);
        if (!rack) return;

        let content = `
            <div style="max-width:800px;margin:0 auto;">
                <h3>${Format.esc(rack.name)} ${rack.location ? `— ${Format.esc(rack.location)}` : ''}</h3>
                <div id="rackDetailView" style="margin:20px 0;"></div>
            </div>
        `;
        document.getElementById('pageContainer').innerHTML = `
            <div class="page-header">
                <a href="#" onclick="App.navigateTo('racks');return false;" class="back-link">
                    <i class="fas fa-arrow-left"></i> Back to Racks
                </a>
                <h2>${Format.esc(rack.name)}</h2>
                <button class="btn btn-primary" onclick="RacksPage.showPlaceDeviceModal('${rackId}')">
                    <i class="fas fa-plus"></i> Place Device
                </button>
            </div>
            <div id="rackDetailContainer"></div>
        `;

        try {
            const devices = await API.getRackDevices(rackId);
            document.getElementById('rackDetailContainer').innerHTML = `
                <div class="rack-detail-view">
                    ${RackView.renderStatic(rack.height, devices, rack.width)}
                </div>
                <div class="card" style="margin-top:20px;">
                    <h4>Devices in Rack</h4>
                    <table class="data-table">
                        <thead>
                            <tr><th>RU</th><th>Device</th><th>IP</th><th>Status</th><th>Actions</th></tr>
                        </thead>
                        <tbody>
                            ${devices.map(d => `
                                <tr>
                                    <td>U${d.ru_position}-U${d.ru_position + d.ru_height - 1}</td>
                                    <td><a href="#/devices/${d.device_id}">${Format.esc(d.device?.name || 'Unknown')}</a></td>
                                    <td><code>${Format.esc(d.device?.ip_address || '-')}</code></td>
                                    <td><span class="status-indicator status-${d.device?.status || 'unknown'}"></span></td>
                                    <td>
                                        <button class="btn btn-sm btn-danger"
                                                onclick="RacksPage.removeDevice('${rackId}','${d.device_id}')">
                                            <i class="fas fa-times"></i> Remove
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        } catch (e) {
            document.getElementById('rackDetailContainer').innerHTML =
                `<p class="error-text">${e.message}</p>`;
        }
    },

    async showPlaceDeviceModal(rackId) {
        try {
            const devices = await API.getDevices();
            const rackDevices = await API.getRackDevices(rackId);
            const placedIds = new Set(rackDevices.map(d => d.device_id));
            const available = devices.filter(d => !placedIds.has(d.id));

            App.showModal('Place Device in Rack', `
                <div class="form-group">
                    <label>Device</label>
                    <select id="placeDeviceId" class="form-input">
                        ${available.map(d => `
                            <option value="${d.id}">${d.name} (${d.ip_address})</option>
                        `).join('')}
                    </select>
                    ${available.length === 0 ? '<small class="text-warning">All devices are already placed</small>' : ''}
                </div>
                <div class="form-group">
                    <label>Starting RU Position (1 = top)</label>
                    <input type="number" id="placeRUPosition" class="form-input" value="1" min="1">
                </div>
                <div class="form-group">
                    <label>Device Height (RU)</label>
                    <input type="number" id="placeRUHeight" class="form-input" value="1" min="1" max="42">
                </div>
            `, async (box) => {
                const deviceId = box.querySelector('#placeDeviceId').value;
                if (!deviceId) throw new Error('No available devices');
                await API.placeDeviceInRack(rackId, {
                    device_id: deviceId,
                    ru_position: parseInt(box.querySelector('#placeRUPosition').value) || 1,
                    ru_height: parseInt(box.querySelector('#placeRUHeight').value) || 1,
                });
                App.toast('Device placed in rack', 'success');
                this.showRackDetail(rackId);
            });
        } catch (e) {
            App.toast('Failed to load devices: ' + e.message, 'danger');
        }
    },

    async removeDevice(rackId, deviceId) {
        if (!confirm('Remove this device from the rack?')) return;
        try {
            await API.removeDeviceFromRack(rackId, deviceId);
            App.toast('Device removed from rack', 'info');
            this.showRackDetail(rackId);
        } catch (e) {
            App.toast('Failed to remove device: ' + e.message, 'danger');
        }
    },

};
