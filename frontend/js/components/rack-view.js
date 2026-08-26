/**
 * Rack View Component — renders a front-view rack visualization with RU markings.
 */
const RackView = {
    /** Pixels per rack unit */
    RU_HEIGHT: 20,
    /** Width of RU number column */
    LABEL_WIDTH: 40,
    /** Default rack width in px */
    RACK_WIDTH: 300,

    /**
     * Render a static rack preview.
     * @param {number} rackHeight - Rack height in RU
     * @param {Array} devices - Array of {ru_position, ru_height, device:{name,device_type,status}}
     * @param {number} rackWidth - Rack width in inches (default 19)
     * @returns {string} HTML string
     */
    renderStatic(rackHeight, devices, rackWidth = 19) {
        const rackPxHeight = rackHeight * this.RU_HEIGHT + 20;
        const rackPxWidth = this.RACK_WIDTH;

        // Build a map of RU position -> device
        const ruMap = {};
        for (const d of devices) {
            const start = d.ru_position;
            const end = start + (d.ru_height || 1) - 1;
            for (let u = start; u <= end; u++) {
                ruMap[u] = d;
            }
        }

        let html = `
        <div class="rack-frame" style="height:${rackPxHeight}px;width:${rackPxWidth}px;position:relative;background:#2c2c36;border:2px solid #555;border-radius:4px;overflow:hidden;">
            <!-- RU labels -->
            <div style="position:absolute;left:0;top:10px;width:${this.LABEL_WIDTH}px;height:${rackHeight * this.RU_HEIGHT}px;">`;

        for (let u = 1; u <= rackHeight; u++) {
            const y = (u - 1) * this.RU_HEIGHT;
            html += `
                <div style="position:absolute;top:${y}px;left:0;width:100%;height:${this.RU_HEIGHT}px;
                            border-bottom:1px solid #3a3a45;color:#777;font-size:9px;line-height:${this.RU_HEIGHT}px;text-align:center;">
                    ${u}
                </div>`;
        }

        html += `</div>
            <!-- Device area -->
            <div style="position:absolute;left:${this.LABEL_WIDTH}px;top:10px;right:5px;height:${rackHeight * this.RU_HEIGHT}px;">`;

        // Draw RU grid lines
        for (let u = 1; u <= rackHeight; u++) {
            const y = (u - 1) * this.RU_HEIGHT;
            const isFifth = u % 5 === 0;
            html += `
                <div style="position:absolute;top:${y}px;left:0;width:100%;height:${this.RU_HEIGHT}px;
                            border-bottom:1px solid ${isFifth ? '#555' : '#3a3a45'};"></div>`;
        }

        // Draw devices
        const drawnDevices = new Set();
        for (const d of devices) {
            if (drawnDevices.has(d.device_id)) continue;
            drawnDevices.add(d.device_id);

            const top = (d.ru_position - 1) * this.RU_HEIGHT;
            const height = (d.ru_height || 1) * this.RU_HEIGHT;
            const type = d.device?.device_type || 'other';
            const color = CONSTANTS.DEVICE_TYPES[type]?.color || '#95a5a6';
            const status = d.device?.status || 'unknown';
            const statusColor = CONSTANTS.STATUS_COLORS[status];

            html += `
                <div class="rack-device" style="position:absolute;top:${top}px;left:2px;right:2px;height:${height - 2}px;
                            background:${color};border-radius:3px;cursor:pointer;overflow:hidden;
                            border:1px solid rgba(0,0,0,0.3);"
                     title="${Format.esc(d.device?.name || 'Unknown')} (U${d.ru_position})">
                    <div style="position:absolute;top:2px;left:4px;right:4px;">
                        <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${statusColor};margin-right:4px;"></span>
                        <span style="color:#fff;font-size:10px;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                            ${Format.esc(d.device?.name || '?')}
                        </span>
                    </div>
                    <div style="position:absolute;bottom:2px;left:4px;color:rgba(255,255,255,0.7);font-size:8px;">
                        ${CONSTANTS.DEVICE_TYPES[type]?.label || type} | ${d.ru_height}U
                    </div>
                </div>`;
        }

        html += `</div></div>`;
        return html;
    },

    /**
     * Generate a rack with interactive right-click context menus on devices.
     */
    renderInteractive(rackId, rackHeight, devices) {
        const rackPxHeight = rackHeight * this.RU_HEIGHT + 20;
        const rackPxWidth = this.RACK_WIDTH;
        const drawnDevices = new Set();

        let html = `
        <div class="rack-frame rack-interactive" style="height:${rackPxHeight}px;width:${rackPxWidth}px;position:relative;background:#2c2c36;border:2px solid #555;border-radius:4px;">
            <div style="position:absolute;left:0;top:10px;width:${this.LABEL_WIDTH}px;height:${rackHeight * this.RU_HEIGHT}px;">`;

        for (let u = 1; u <= rackHeight; u++) {
            const y = (u - 1) * this.RU_HEIGHT;
            html += `
                <div style="position:absolute;top:${y}px;left:0;width:100%;height:${this.RU_HEIGHT}px;
                            border-bottom:1px solid #3a3a45;color:#777;font-size:9px;line-height:${this.RU_HEIGHT}px;text-align:center;">
                    ${u}
                </div>`;
        }

        html += `</div>
            <div style="position:absolute;left:${this.LABEL_WIDTH}px;top:10px;right:5px;height:${rackHeight * this.RU_HEIGHT}px;">`;

        for (const d of devices) {
            if (drawnDevices.has(d.device_id)) continue;
            drawnDevices.add(d.device_id);

            const top = (d.ru_position - 1) * this.RU_HEIGHT;
            const height = (d.ru_height || 1) * this.RU_HEIGHT;
            const type = d.device?.device_type || 'other';
            const color = CONSTANTS.DEVICE_TYPES[type]?.color || '#95a5a6';
            const statusColor = CONSTANTS.STATUS_COLORS[d.device?.status] || '#95a5a6';

            html += `
                <div class="rack-device rack-device-interactive"
                     data-rack-id="${rackId}" data-device-id="${d.device_id}"
                     data-device-ip="${Format.esc(d.device?.ip_address || '')}"
                     data-device-ssh="${d.device?.ssh_port || 22}"
                     data-device-rdp="${d.device?.rdp_port || 3389}"
                     data-device-web="${d.device?.web_port || 80}"
                     style="position:absolute;top:${top}px;left:2px;right:2px;height:${height - 2}px;
                            background:${color};border-radius:3px;cursor:pointer;overflow:hidden;
                            border:1px solid rgba(0,0,0,0.3);"
                     oncontextmenu="event.preventDefault();
                         ContextMenu.show(event.clientX, event.clientY, 'rack_device', {
                             rackId: '${rackId}',
                             deviceId: '${d.device_id}',
                             device: {id:'${d.device_id}',name:'${Format.esc(d.device?.name||'')}',ip_address:'${d.device?.ip_address||''}',
                                      ssh_port:${d.device?.ssh_port||22},rdp_port:${d.device?.rdp_port||3389},
                                      web_port:${d.device?.web_port||80}}
                         });">
                    <div style="position:absolute;top:2px;left:4px;right:4px;">
                        <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${statusColor};margin-right:4px;"></span>
                        <span style="color:#fff;font-size:10px;font-weight:bold;">${Format.esc(d.device?.name || '?')}</span>
                    </div>
                    <div style="position:absolute;bottom:2px;left:4px;color:rgba(255,255,255,0.7);font-size:8px;">
                        ${CONSTANTS.DEVICE_TYPES[type]?.label || type} | ${d.ru_height}U
                    </div>
                </div>`;
        }

        html += `</div></div>`;
        return html;
    },

};
