/**
 * Number, date, formatting, and common utilities for NMS.
 */
const Format = {
    /**
     * HTML-escape a string.
     */
    esc(s) {
        if (!s) return '';
        const d = document.createElement('div');
        d.textContent = String(s);
        return d.innerHTML;
    },
    /**
     * Format bytes into human-readable size.
     */
    bytes(v, decimals = 1) {
        if (v == null) return 'N/A';
        if (v === 0) return '0 B';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
        const i = Math.floor(Math.log(Math.abs(v)) / Math.log(k));
        return parseFloat((v / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    },

    /**
     * Format bits per second.
     */
    bps(v) {
        if (v == null || v === 0) return '0 bps';
        const units = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
        let unitIndex = 0;
        let val = v;
        while (val >= 1000 && unitIndex < units.length - 1) {
            val /= 1000;
            unitIndex++;
        }
        return val.toFixed(1) + ' ' + units[unitIndex];
    },

    /**
     * Format a percentage value.
     */
    percent(v) {
        if (v == null) return 'N/A';
        return v.toFixed(1) + '%';
    },

    /**
     * Format a datetime string or timestamp.
     */
    /**
     * Parse an ISO datetime string as UTC (append Z if missing).
     */
    _parseUTC(v) {
        const s = String(v);
        return new Date(s.endsWith('Z') || s.includes('+') || s.includes('-', 10) ? s : s + 'Z');
    },

    datetime(v) {
        if (!v) return 'Never';
        const d = this._parseUTC(v);
        if (isNaN(d.getTime())) return 'Invalid';
        return d.toLocaleString('zh-CN', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            timeZone: 'Asia/Shanghai',
        });
    },

    ago(v) {
        if (!v) return 'Never';
        const now = Date.now();
        const then = this._parseUTC(v).getTime();
        if (isNaN(then)) return 'Never';
        const diff = Math.floor((now - then) / 1000);

        if (diff < 0) return 'Now';
        if (diff < 60) return 'Now';
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        return Math.floor(diff / 86400) + 'd ago';
    },

    /**
     * Format a duration in seconds to human-readable.
     */
    duration(seconds) {
        if (seconds < 60) return seconds + 's';
        if (seconds < 3600) return Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return h + 'h ' + m + 'm';
    },

    /**
     * Format SNMP uptime (in hundredths of a second) to human-readable.
     */
    uptime(ticks) {
        if (!ticks) return 'N/A';
        const seconds = Math.floor(ticks / 100);
        return Format.duration(seconds);
    },
};
