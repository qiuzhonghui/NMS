/**
 * 设置页面 — 监控设置 + AI 设置。
 * 从侧边栏"设置"进入，两栏布局：左侧监控参数，右侧 AI 配置。
 */
const SettingsPage = {
    async render() {
        document.getElementById('pageContainer').innerHTML = `
        <div class="page-header">
            <h2><i class="fas fa-cog"></i> ${I18N.t('settings')||'Settings'}</h2>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;" id="settingsGrid">
            <div id="monitoringSettingsPanel"></div>
            <div id="aiSettingsPanel"></div>
        </div>`;
        this._renderMonitoring();
        this._renderAI();
    },
    destroy() {},

    // ── 监控设置面板 ──────────────────────────────────────────────────

    async _renderMonitoring() {
        const panel = document.getElementById('monitoringSettingsPanel');
        panel.innerHTML = `
        <div class="card" style="padding:20px;">
            <h3 style="margin-top:0;"><i class="fas fa-heartbeat"></i> ${I18N.t('monitoring_settings')||'Monitoring Settings'}</h3>
            <div class="form-group" style="margin-bottom:14px;">
                <label style="font-weight:600;display:block;margin-bottom:4px;">${I18N.t('icmp_interval_label')||'ICMP Check Interval (s)'}</label>
                <input type="number" id="setIcmpInterval" class="form-input" value="30" min="5" max="3600">
                <small style="color:#999;">${I18N.t('icmp_interval_hint')||'How often to ping devices'}</small>
            </div>
            <div class="form-group" style="margin-bottom:14px;">
                <label style="font-weight:600;display:block;margin-bottom:4px;">${I18N.t('snmp_interval_label')||'SNMP Collection Interval (s)'}</label>
                <input type="number" id="setSnmpInterval" class="form-input" value="60" min="10" max="3600">
                <small style="color:#999;">${I18N.t('snmp_interval_hint')||'How often to poll SNMP'}</small>
            </div>
            <div class="form-group" style="margin-bottom:14px;">
                <label style="font-weight:600;display:block;margin-bottom:4px;">${I18N.t('alert_interval_label')||'Alert Check Interval (s)'}</label>
                <input type="number" id="setAlertInterval" class="form-input" value="60" min="10" max="3600">
                <small style="color:#999;">${I18N.t('alert_interval_hint')||'How often to evaluate alerts'}</small>
            </div>
            <div class="form-group" style="margin-bottom:14px;">
                <label style="font-weight:600;display:block;margin-bottom:4px;">${I18N.t('scan_concurrency_label')||'Scan Concurrency'}</label>
                <input type="number" id="setScanConcurrency" class="form-input" value="${localStorage.getItem('scan_concurrency')||50}" min="10" max="500" step="10">
                <small style="color:#999;">${I18N.t('scan_concurrency_hint')||'How many IPs to scan simultaneously'}</small>
            </div>
            <button class="btn btn-primary" onclick="SettingsPage._saveMonitoring()"><i class="fas fa-save"></i> ${I18N.t('save')}</button>
        </div>`;

        // 加载当前值
        try {
            const res = await API.get('/settings');
            if (res.icmp_interval) document.getElementById('setIcmpInterval').value = res.icmp_interval;
            if (res.snmp_interval) document.getElementById('setSnmpInterval').value = res.snmp_interval;
            if (res.alert_interval) document.getElementById('setAlertInterval').value = res.alert_interval;
        } catch(e) {}
    },

    async _saveMonitoring() {
        const concurrency = parseInt(document.getElementById('setScanConcurrency').value) || 50;
        localStorage.setItem('scan_concurrency', concurrency);
        localStorage.setItem('nms_test_concurrency', document.getElementById('testConcurrency').value || '3');
        localStorage.setItem('nms_test_retries', document.getElementById('testRetries').value || '1');
        const data = {
            icmp_interval: parseInt(document.getElementById('setIcmpInterval').value) || 30,
            snmp_interval: parseInt(document.getElementById('setSnmpInterval').value) || 60,
            alert_interval: parseInt(document.getElementById('setAlertInterval').value) || 60,
        };
        try {
            await API.post('/settings', data);
            App.toast(I18N.t('settings_saved')||'Settings saved', 'success');
        } catch(e) {
            App.toast((I18N.t('failed')||'Failed')+': '+e.message, 'danger');
        }
    },

    // ── AI 设置面板 ──────────────────────────────────────────────────

    async _renderAI() {
        const panel = document.getElementById('aiSettingsPanel');
        panel.innerHTML = `
        <div class="card" style="padding:20px;">
            <h3 style="margin-top:0;"><i class="fas fa-robot"></i> ${I18N.t('ai_settings')||'AI Settings'}</h3>
            <p style="color:#999;font-size:12px;margin-bottom:14px;">${I18N.t('ai_settings_desc')||'Configure AI API for MIB analysis. Supports OpenAI-compatible APIs.'}</p>

            <div class="form-group" style="margin-bottom:14px;">
                <label style="font-weight:600;display:block;margin-bottom:4px;">${I18N.t('ai_provider')||'Provider'}</label>
                <select id="aiProvider" class="form-input">
                    <option value="openai">OpenAI</option>
                    <option value="azure">Azure OpenAI</option>
                    <option value="deepseek">DeepSeek</option>
                    <option value="local">Local (Ollama/vLLM)</option>
                    <option value="custom">${I18N.t('custom')||'Custom'}</option>
                </select>
            </div>
            <div class="form-group" style="margin-bottom:14px;">
                <label style="font-weight:600;display:block;margin-bottom:4px;">API Key</label>
                <input type="password" id="aiApiKey" class="form-input" placeholder="sk-...">
                <small style="color:#999;">${I18N.t('ai_key_hint')||'Your API key. Stored encrypted on the server.'}</small>
            </div>
            <div class="form-group" style="margin-bottom:14px;">
                <label style="font-weight:600;display:block;margin-bottom:4px;">API Base URL</label>
                <input type="text" id="aiApiBase" class="form-input" placeholder="https://api.openai.com/v1">
                <small style="color:#999;">${I18N.t('ai_base_hint')||'The base URL of the API endpoint'}</small>
            </div>
            <div class="form-group" style="margin-bottom:14px;">
                <label style="font-weight:600;display:block;margin-bottom:4px;">${I18N.t('ai_model')||'Model Name'}</label>
                <input type="text" id="aiModelName" class="form-input" placeholder="gpt-4o-mini">
                <small style="color:#999;">${I18N.t('ai_model_hint')||'e.g. gpt-4o-mini, gpt-4o, deepseek-chat, qwen2.5'}</small>
            </div>
            <div class="form-group" style="margin-bottom:14px;">
                <label style="font-weight:600;display:block;margin-bottom:4px;">${I18N.t('ai_batch_size')||'Batch Size'}</label>
                <input type="number" id="aiBatchSize" class="form-input" value="100" min="20" max="500" step="10">
                <small style="color:#999;">${I18N.t('ai_batch_hint')||'Max OIDs per AI call. Large lists are split into multiple rounds.'}</small>
            </div>
            <div class="form-group" style="margin-bottom:14px;">
                <label style="font-weight:600;display:block;margin-bottom:4px;">${I18N.t('ai_concurrency')||'Concurrency'}</label>
                <input type="number" id="aiConcurrency" class="form-input" value="3" min="1" max="10" step="1">
                <small style="color:#999;">${I18N.t('ai_concurrency_hint')||'Parallel AI calls per group'}</small>
            </div>
            <div style="display:flex;gap:12px;margin-bottom:14px;">
                <div style="flex:1;">
                    <label style="font-weight:600;display:block;margin-bottom:4px;">${I18N.t('ai_req_timeout')||'Request Timeout(s)'}</label>
                    <input type="number" id="aiReqTimeout" class="form-input" value="120" min="30" max="600" step="10">
                </div>
                <div style="flex:1;">
                    <label style="font-weight:600;display:block;margin-bottom:4px;">${I18N.t('ai_grp_timeout')||'Group Timeout(s)'}</label>
                    <input type="number" id="aiGrpTimeout" class="form-input" value="180" min="60" max="900" step="30">
                </div>
            </div>
            <div style="display:flex;gap:12px;margin-bottom:14px;">
                <div style="flex:1;">
                    <label style="font-weight:600;display:block;margin-bottom:4px;">${I18N.t('test_concurrency')||'Test Concurrency'}</label>
                    <input type="number" id="testConcurrency" class="form-input" value="3" min="1" max="20" step="1">
                </div>
                <div style="flex:1;">
                    <label style="font-weight:600;display:block;margin-bottom:4px;">${I18N.t('test_retries')||'Test Retries'}</label>
                    <input type="number" id="testRetries" class="form-input" value="1" min="0" max="5" step="1">
                </div>
            </div>
            <div style="display:flex;gap:8px;">
                <button class="btn btn-primary" onclick="SettingsPage._saveAI()"><i class="fas fa-save"></i> ${I18N.t('save')}</button>
                <button class="btn" onclick="SettingsPage._testAI()"><i class="fas fa-plug"></i> ${I18N.t('test_connection')||'Test'}</button>
            </div>
            <div id="aiTestResult" style="margin-top:10px;"></div>
        </div>`;

        // 加载当前 AI 设置
        try {
            const res = await API.get('/ai-settings');
            if (res.configured) {
                document.getElementById('aiProvider').value = res.provider || 'openai';
                document.getElementById('aiApiKey').value = res.api_key || '';  // 脱敏的占位
                document.getElementById('aiApiBase').value = res.api_base || '';
                document.getElementById('aiModelName').value = res.model_name || '';
                document.getElementById('aiBatchSize').value = res.batch_size || 100;
                document.getElementById('aiConcurrency').value = res.ai_concurrency || 3;
                document.getElementById('aiReqTimeout').value = res.request_timeout || 120;
                document.getElementById('aiGrpTimeout').value = res.group_timeout || 180;
                document.getElementById('testConcurrency').value = localStorage.getItem('nms_test_concurrency') || '3';
                document.getElementById('testRetries').value = localStorage.getItem('nms_test_retries') || '1';
                if (res.api_key && res.api_key.includes('****')) {
                    document.getElementById('aiApiKey').placeholder = '(已保存，输入新值覆盖)';
                    document.getElementById('aiApiKey').value = '';
                }
            }
        } catch(e) {}
    },

    async _saveAI() {
        const apiKeyInput = document.getElementById('aiApiKey').value.trim();
        const data = {
            provider: document.getElementById('aiProvider').value,
            api_key: apiKeyInput,
            api_base: document.getElementById('aiApiBase').value,
            model_name: document.getElementById('aiModelName').value,
            batch_size: parseInt(document.getElementById('aiBatchSize').value) || 100,
            ai_concurrency: parseInt(document.getElementById('aiConcurrency').value) || 3,
            request_timeout: parseInt(document.getElementById('aiReqTimeout').value) || 120,
            group_timeout: parseInt(document.getElementById('aiGrpTimeout').value) || 180,
            enabled: true,
        };
        try {
            await API.post('/ai-settings', data);
            App.toast(I18N.t('settings_saved')||'AI settings saved', 'success');
            // 保存后刷新面板以显示脱敏 key
            this._renderAI();
        } catch(e) {
            App.toast((I18N.t('failed')||'Failed')+': '+e.message, 'danger');
        }
    },

    async _testAI() {
        const resultEl = document.getElementById('aiTestResult');
        resultEl.innerHTML = '<div class="spinner"></div>';
        try {
            const res = await API.post('/ai-settings/test', {});
            if (res.status === 'ok') {
                resultEl.innerHTML = `<div style="color:#27ae60;"><i class="fas fa-check-circle"></i> ${res.message}</div>
                    ${res.available_models ? '<div style="font-size:11px;color:#999;margin-top:4px;">Models: '+res.available_models.join(', ')+'</div>' : ''}`;
            } else {
                resultEl.innerHTML = `<div style="color:#e74c3c;"><i class="fas fa-times-circle"></i> ${res.message}</div>`;
            }
        } catch(e) {
            resultEl.innerHTML = `<div style="color:#e74c3c;"><i class="fas fa-times-circle"></i> ${e.message}</div>`;
        }
    },
};
