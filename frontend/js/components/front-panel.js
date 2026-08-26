/**
 * Front Panel Component — HTML5 Canvas based device faceplate with port status.
 */
const FrontPanel = {
    canvas: null,
    panelData: null,
    ports: [],
    refreshTimer: null,

    /**
     * Render a front panel onto a container element.
     * @param {string} panelId - Front panel ID from the API
     * @param {HTMLElement} container - Container element to render into
     */
    async render(panelId, container) {
        if (!container) return;

        try {
            this.ports = await API.getFrontPanelPorts(panelId);

            container.innerHTML = `
                <div class="front-panel-container" style="position:relative;display:inline-block;">
                    <canvas id="frontPanelCanvas" width="800" height="300"
                            style="background:#1a1a2e;border-radius:8px;border:2px solid #333;"></canvas>
                </div>
            `;

            this.canvas = document.getElementById('frontPanelCanvas');
            if (this.canvas) {
                this._drawPanel();

                // Click handler for port selection
                this.canvas.addEventListener('click', (e) => this._onCanvasClick(e));

                // Auto-refresh ports
                this.refreshTimer = setInterval(async () => {
                    this.ports = await API.getFrontPanelPorts(panelId);
                    this._drawPanel();
                }, CONSTANTS.POLLING.METRICS);
            }
        } catch (e) {
            container.innerHTML = `<p class="text-muted">Front panel not available: ${e.message}</p>`;
        }
    },

    /**
     * Draw the front panel with all ports.
     */
    _drawPanel() {
        if (!this.canvas) return;
        const ctx = this.canvas.getContext('2d');
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Clear
        ctx.clearRect(0, 0, w, h);

        // Background
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, w, h);

        // Device model label
        ctx.fillStyle = '#95a5a6';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Device Front Panel', w / 2, 25);

        // Draw ports
        for (const port of this.ports) {
            this._drawPort(ctx, port);
        }

        // Legend
        ctx.fillStyle = '#2ecc71';
        ctx.fillRect(w - 120, 10, 10, 10);
        ctx.fillStyle = '#95a5a6';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('UP', w - 105, 20);

        ctx.fillStyle = '#555';
        ctx.fillRect(w - 120, 25, 10, 10);
        ctx.fillText('DOWN', w - 105, 35);
    },

    /**
     * Draw a single port on the canvas.
     */
    _drawPort(ctx, port) {
        const x = port.x || 0;
        const y = port.y || 0;

        // Port color based on status
        const isUp = port.status === 'up';
        const fillColor = isUp ? '#2ecc71' : '#555555';
        const borderColor = isUp ? '#27ae60' : '#444444';

        // Draw port shape based on type
        switch (port.port_type) {
        case 'sfp':
        case 'sfp+':
        case 'qsfp':
        case 'qsfp28':
            // Draw as rectangle (SFP cage)
            ctx.fillStyle = fillColor;
            ctx.fillRect(x - 10, y - 6, 20, 12);
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 1;
            ctx.strokeRect(x - 10, y - 6, 20, 12);
            break;
        case 'console':
            // Draw as small circle (console port)
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fillStyle = fillColor;
            ctx.fill();
            ctx.strokeStyle = borderColor;
            ctx.stroke();
            break;
        case 'power':
            // Draw as larger circle
            ctx.beginPath();
            ctx.arc(x, y, 7, 0, Math.PI * 2);
            ctx.fillStyle = fillColor;
            ctx.fill();
            ctx.strokeStyle = borderColor;
            ctx.stroke();
            break;
        case 'rj45':
        default:
            // Draw as rounded rectangle (RJ45 port)
            const rx = x - 7, ry = y - 5, rw = 14, rh = 10;
            const radius = 2;
            ctx.beginPath();
            ctx.moveTo(rx + radius, ry);
            ctx.lineTo(rx + rw - radius, ry);
            ctx.arcTo(rx + rw, ry, rx + rw, ry + radius, radius);
            ctx.lineTo(rx + rw, ry + rh - radius);
            ctx.arcTo(rx + rw, ry + rh, rx + rw - radius, ry + rh, radius);
            ctx.lineTo(rx + radius, ry + rh);
            ctx.arcTo(rx, ry + rh, rx, ry + rh - radius, radius);
            ctx.lineTo(rx, ry + radius);
            ctx.arcTo(rx, ry, rx + radius, ry, radius);
            ctx.closePath();
            ctx.fillStyle = fillColor;
            ctx.fill();
            ctx.strokeStyle = borderColor;
            ctx.stroke();
            break;
        }

        // Port label
        ctx.fillStyle = '#ecf0f1';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(port.label, x, y + 18);
    },

    /**
     * Handle click on the canvas to show port details.
     */
    _onCanvasClick(event) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const mx = (event.clientX - rect.left) * scaleX;
        const my = (event.clientY - rect.top) * scaleY;

        // Find closest port
        let closest = null;
        let minDist = 30; // Max click distance

        for (const port of this.ports) {
            const dx = mx - (port.x || 0);
            const dy = my - (port.y || 0);
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minDist) {
                minDist = dist;
                closest = port;
            }
        }

        if (closest) {
            App.toast(
                `Port ${closest.label}: ${closest.status?.toUpperCase() || 'Unknown'} ` +
                `(${closest.port_type})` +
                (closest.if_name ? ` — ${closest.if_name}` : ''),
                closest.status === 'up' ? 'success' : 'warning'
            );
        }
    },

    /**
     * Clean up timers.
     */
    destroy() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
        this.canvas = null;
        this.ports = [];
    },
};
