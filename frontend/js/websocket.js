/**
 * WebSocket client with auto-reconnect and event dispatch.
 */
class NMSWebSocket {
    constructor() {
        this.ws = null;
        this.reconnectTimer = null;
        this.reconnectDelay = 1000;
        this.maxReconnectDelay = 30000;
        this.listeners = {};
        this.subscribedDevices = new Set();
    }

    /**
     * Connect to the WebSocket server.
     */
    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${window.location.host}/ws`;

        try {
            this.ws = new WebSocket(url);
        } catch (e) {
            console.error('WebSocket connection failed:', e);
            this.scheduleReconnect();
            return;
        }

        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.reconnectDelay = 1000;
            this.updateStatus(true);

            // Re-subscribe to devices
            for (const deviceId of this.subscribedDevices) {
                this._send({ action: 'subscribe_device', device_id: deviceId });
            }

            this.emit('connected');
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            } catch (e) {
                console.error('WS message parse error:', e);
            }
        };

        this.ws.onclose = (event) => {
            console.log('WebSocket disconnected:', event.code);
            this.updateStatus(false);
            this.emit('disconnected');
            this.scheduleReconnect();
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }

    /**
     * Handle incoming WebSocket messages.
     */
    handleMessage(data) {
        const { event, ...payload } = data;

        // Route to specific handlers
        switch (event) {
        case 'metric_update':
            this.emit('metric_update', payload);
            break;
        case 'device_status':
            this.emit('device_status', payload);
            break;
        case 'interface_status':
            this.emit('interface_status', payload);
            break;
        case 'alert':
            this.emit('alert', payload);
            break;
        case 'scan_progress':
            this.emit('scan_progress', payload);
            break;
        case 'scan_complete':
            this.emit('scan_complete', payload);
            break;
        case 'device_added':
            this.emit('device_added', payload);
            break;
        case 'device_removed':
            this.emit('device_removed', payload);
            break;
        case 'subscribed':
            this.emit('subscribed', payload);
            break;
        case 'pong':
            break;
        default:
            this.emit(event, payload);
        }
    }

    /**
     * Subscribe to real-time metrics for a device.
     */
    subscribeDevice(deviceId) {
        this.subscribedDevices.add(deviceId);
        this._send({ action: 'subscribe_device', device_id: deviceId });
    }

    /**
     * Unsubscribe from a device's metrics.
     */
    unsubscribeDevice(deviceId) {
        this.subscribedDevices.delete(deviceId);
        this._send({ action: 'unsubscribe_device', device_id: deviceId });
    }

    /**
     * Register an event listener.
     */
    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }

    /**
     * Remove an event listener.
     */
    off(event, callback) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }

    /**
     * Emit an event to registered listeners.
     */
    emit(event, data) {
        if (!this.listeners[event]) return;
        for (const callback of this.listeners[event]) {
            try {
                callback(data);
            } catch (e) {
                console.error(`WS event handler error [${event}]:`, e);
            }
        }
    }

    /**
     * Send a message to the server.
     */
    _send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    /**
     * Schedule reconnection with exponential backoff.
     */
    scheduleReconnect() {
        if (this.reconnectTimer) return;

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            console.log(`Reconnecting in ${this.reconnectDelay}ms...`);
            this.connect();
            this.reconnectDelay = Math.min(
                this.reconnectDelay * 2,
                this.maxReconnectDelay
            );
        }, this.reconnectDelay);
    }

    /**
     * Update the sidebar WS status indicator.
     */
    updateStatus(connected) {
        const el = document.getElementById('wsStatus');
        if (el) {
            el.innerHTML = connected
                ? '<span style="color:#2ecc71;">●</span> Connected'
                : '<span style="color:#e74c3c;">●</span> Disconnected';
        }
    }
}

// Singleton
const NMS_WS = new NMSWebSocket();
