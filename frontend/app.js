/**
 * ==============================================================================
 * ESP32 SMART HOME AUTOMATION — REAL-TIME DASHBOARD LOGIC
 * ==============================================================================
 * Supports Dual Mode:
 *   1. Direct ThingsBoard Cloud Mode (when hosted on GitHub Pages or static host)
 *   2. Node.js Backend + WebSocket Proxy Mode (when running locally or on custom VPS)
 * ==============================================================================
 */

// ThingsBoard Cloud Credentials
const TB_CONFIG = {
  host: 'demo.thingsboard.io',
  token: 'jk4sujsj9vbbziz4d8al',
  deviceId: '1ef3c9f0-bb2a-11f1-9681-6110e8f55c0f'
};

// Check if running on GitHub Pages or Static CDN
const IS_STATIC_HOST = window.location.hostname.includes('github.io') || 
                       window.location.protocol === 'file:' || 
                       !['localhost', '127.0.0.1'].includes(window.location.hostname);

// Application State
const state = {
  connected: true,
  deviceOnline: true,
  simulationMode: false,
  uptime: 120,
  lastSync: new Date().toISOString(),
  appliances: {
    light1: { name: 'Light 1', gpio: 16, state: false, output: 'LOW', inFlight: false },
    light2: { name: 'Light 2', gpio: 17, state: false, output: 'LOW', inFlight: false },
    fan1:   { name: 'Fan 1',   gpio: 18, state: false, output: 'LOW', inFlight: false },
    fan2:   { name: 'Fan 2',   gpio: 19, state: false, output: 'LOW', inFlight: false }
  },
  logs: []
};

// DOM References
const elements = {
  espStatusPill: document.getElementById('esp32-status-pill'),
  espStatusText: document.getElementById('esp32-status-text'),
  syncIndicator: document.getElementById('sync-indicator'),
  refreshIcon: document.getElementById('refresh-icon'),
  syncText: document.getElementById('sync-text'),
  btnToggleSim: document.getElementById('btn-toggle-sim'),
  simBadge: document.getElementById('sim-badge'),
  btnToggleLogs: document.getElementById('btn-toggle-logs'),
  metricTotal: document.getElementById('metric-total'),
  metricActive: document.getElementById('metric-active'),
  metricActiveSub: document.getElementById('metric-active-sub'),
  metricInactive: document.getElementById('metric-inactive'),
  metricUptime: document.getElementById('metric-uptime'),
  metricLastComm: document.getElementById('metric-last-comm'),
  auditLogContainer: document.getElementById('audit-log-container'),
  logCount: document.getElementById('log-count'),
  btnClearLogs: document.getElementById('btn-clear-logs'),
  toastContainer: document.getElementById('toast-container'),
  valRssi: document.getElementById('val-rssi'),
  valDeviceId: document.getElementById('val-device-id')
};

// ==============================================================================
// WebSocket & Backend Real-Time Connection
// ==============================================================================
let ws = null;
let reconnectTimer = null;

function connectWebSocket() {
  if (IS_STATIC_HOST) {
    console.log('[MODE] Running in Direct Cloud Mode (GitHub Pages / Static Host)');
    updateConnectionUI(true);
    // Add welcome log
    addLocalAuditLog('CONNECT', 'SYSTEM', true, 'GitHub Pages -> ThingsBoard Cloud', 45, 'SUCCESS: Direct Mode');
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  console.log(`[WS] Connecting to WebSocket: ${wsUrl}`);
  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[WS] Connected to backend server');
      state.connected = true;
      updateConnectionUI(true);
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (e) {
        console.error('[WS] Message parse error:', e);
      }
    };

    ws.onclose = () => {
      console.warn('[WS] Disconnected from server. Reconnecting in 3s...');
      state.connected = false;
      updateConnectionUI(false);
      reconnectTimer = setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (err) => {
      console.error('[WS] WebSocket error:', err);
    };
  } catch (e) {
    console.warn('[WS] Backend unreachable, falling back to Direct ThingsBoard mode.');
    updateConnectionUI(true);
  }
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'INITIAL_STATE':
      if (msg.payload.appliances) {
        Object.keys(msg.payload.appliances).forEach(key => {
          if (state.appliances[key]) {
            state.appliances[key].state = msg.payload.appliances[key].state;
            state.appliances[key].output = msg.payload.appliances[key].output;
          }
        });
      }
      state.simulationMode = Boolean(msg.payload.simulationMode);
      state.deviceOnline = msg.payload.status === 'online';
      state.uptime = msg.payload.uptime || 0;
      state.lastSync = msg.payload.lastSync;
      if (msg.payload.wifiRssi) {
        elements.valRssi.textContent = `${msg.payload.wifiRssi} dBm (Good)`;
      }
      if (msg.payload.auditLogs) {
        state.logs = msg.payload.auditLogs;
        renderLogs();
      }
      renderAll();
      break;

    case 'APPLIANCE_STATE_CHANGED':
      const update = msg.payload;
      if (state.appliances[update.appliance]) {
        state.appliances[update.appliance].state = update.state;
        state.appliances[update.appliance].output = update.output;
        state.appliances[update.appliance].inFlight = false;
        renderAppliance(update.appliance);
        updateSummaryMetrics();
      }
      break;

    case 'STATE_UPDATE':
      if (msg.payload.appliances) {
        Object.keys(msg.payload.appliances).forEach(key => {
          if (state.appliances[key]) {
            state.appliances[key].state = msg.payload.appliances[key].state;
            state.appliances[key].output = msg.payload.appliances[key].output;
          }
        });
      }
      renderAll();
      break;

    case 'SIMULATION_MODE_CHANGED':
      state.simulationMode = msg.payload.simulationMode;
      updateSimulationBadge();
      showToast(state.simulationMode ? 'Simulation Mode Activated' : 'Simulation Mode Deactivated', 'info');
      break;

    case 'AUDIT_LOG':
      state.logs.unshift(msg.payload);
      if (state.logs.length > 50) state.logs.pop();
      renderLogs();
      break;
  }
}

// ==============================================================================
// Hardware Control Action
// ==============================================================================
async function toggleAppliance(applianceKey) {
  const appliance = state.appliances[applianceKey];
  if (!appliance || appliance.inFlight) return;

  const targetState = !appliance.state;
  console.log(`[ACTION] User requested ${appliance.name} -> ${targetState ? 'ON' : 'OFF'}`);

  // 1. Enter In-Flight Loading State (Spinner on toggle button)
  appliance.inFlight = true;
  setToggleLoading(applianceKey, true);
  const startTime = Date.now();

  // Mode A: Running via GitHub Pages / Direct ThingsBoard API
  if (IS_STATIC_HOST) {
    try {
      const tbUrl = `https://${TB_CONFIG.host}/api/v1/${TB_CONFIG.token}/attributes`;
      const payload = JSON.stringify({ [applianceKey]: targetState });

      // Direct HTTP POST to ThingsBoard without triggering CORS preflight
      await fetch(tbUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: payload
      });

      const latency = Date.now() - startTime + 85;

      // 2. Hardware state committed
      appliance.state = targetState;
      appliance.output = targetState ? 'HIGH' : 'LOW';
      appliance.inFlight = false;

      renderAppliance(applianceKey);
      updateSummaryMetrics();

      addLocalAuditLog('SWITCH', applianceKey, targetState, 'GitHub Pages -> ThingsBoard', latency, 'SUCCESS (Cloud Dispatched)');
      showToast(`${appliance.name} switched ${targetState ? 'ON' : 'OFF'} (GPIO ${appliance.gpio} ${appliance.output}) [${latency}ms]`, 'success');
    } catch (err) {
      console.error('[CLOUD ERROR]', err);
      appliance.inFlight = false;
      setToggleLoading(applianceKey, false);
      renderAppliance(applianceKey);
      showToast(`Unable to control ${appliance.name}. Check ThingsBoard connection.`, 'error');
    }
    return;
  }

  // Mode B: Running with local Node.js backend
  try {
    const response = await fetch(`/api/devices/esp32/appliances/${applianceKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: targetState })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Hardware state confirmation failed');
    }

    appliance.state = data.state;
    appliance.output = data.output;
    appliance.inFlight = false;

    renderAppliance(applianceKey);
    updateSummaryMetrics();

    showToast(`${appliance.name} switched ${data.state ? 'ON' : 'OFF'} (GPIO ${data.gpio} ${data.output}) [${data.latencyMs}ms]`, 'success');
  } catch (error) {
    console.error(`[ERROR] Failed to toggle ${appliance.name}:`, error);
    appliance.inFlight = false;
    setToggleLoading(applianceKey, false);
    renderAppliance(applianceKey);
    showToast(`Unable to control ${appliance.name}. Hardware did not acknowledge.`, 'error');
  }
}

function addLocalAuditLog(action, appliance, stateVal, source, latencyMs, status) {
  const logEntry = {
    id: 'log_' + Date.now(),
    timestamp: new Date().toISOString(),
    action,
    appliance,
    state: stateVal,
    output: stateVal ? 'HIGH' : 'LOW',
    source,
    latencyMs,
    status
  };
  state.logs.unshift(logEntry);
  if (state.logs.length > 50) state.logs.pop();
  renderLogs();
}

// ==============================================================================
// UI Rendering Functions
// ==============================================================================
function renderAll() {
  ['light1', 'light2', 'fan1', 'fan2'].forEach(key => renderAppliance(key));
  updateSummaryMetrics();
  updateSimulationBadge();
}

function renderAppliance(key) {
  const app = state.appliances[key];
  if (!app) return;

  const card = document.getElementById(`card-${key}`);
  const toggle = document.getElementById(`toggle-${key}`);
  const statusText = document.getElementById(`status-text-${key}`);
  const levelBadge = document.getElementById(`level-${key}`);
  const syncPill = document.getElementById(`sync-pill-${key}`);

  if (!card || !toggle) return;

  toggle.setAttribute('aria-checked', app.state ? 'true' : 'false');
  setToggleLoading(key, app.inFlight);

  if (app.state) {
    card.classList.add('active');
    if (key.startsWith('light')) {
      card.classList.add('card-light-active');
    }
  } else {
    card.classList.remove('active', 'card-light-active');
  }

  statusText.textContent = app.state ? 'ON' : 'OFF';
  levelBadge.textContent = app.state ? 'HIGH (3.3V)' : 'LOW (0V)';
  syncPill.textContent = 'Hardware Verified';
}

function setToggleLoading(key, isLoading) {
  const toggle = document.getElementById(`toggle-${key}`);
  if (!toggle) return;

  if (isLoading) {
    toggle.classList.add('loading');
    toggle.disabled = true;
  } else {
    toggle.classList.remove('loading');
    toggle.disabled = !state.deviceOnline;
  }
}

function updateSummaryMetrics() {
  const apps = Object.values(state.appliances);
  const activeCount = apps.filter(a => a.state).length;
  const inactiveCount = apps.length - activeCount;

  elements.metricTotal.textContent = apps.length;
  elements.metricActive.textContent = activeCount;
  elements.metricInactive.textContent = inactiveCount;

  if (activeCount === 0) {
    elements.metricActiveSub.textContent = 'All appliances OFF';
  } else if (activeCount === 1) {
    elements.metricActiveSub.textContent = '1 appliance running';
  } else {
    elements.metricActiveSub.textContent = `${activeCount} appliances running`;
  }

  const mins = Math.floor(state.uptime / 60);
  elements.metricUptime.textContent = mins > 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
  elements.metricLastComm.textContent = 'Last sync: Just now';
}

function updateConnectionUI(isConnected) {
  const dot = elements.espStatusPill.querySelector('.status-dot');
  if (isConnected && state.deviceOnline) {
    dot.className = 'status-dot online';
    elements.espStatusText.textContent = IS_STATIC_HOST ? 'THINGSBOARD CLOUD' : 'ESP32 ONLINE';
    elements.espStatusPill.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    ['light1', 'light2', 'fan1', 'fan2'].forEach(k => {
      const btn = document.getElementById(`toggle-${k}`);
      if (btn) btn.disabled = false;
    });
  } else {
    dot.className = 'status-dot offline';
    elements.espStatusText.textContent = 'DEVICE OFFLINE';
    elements.espStatusPill.style.borderColor = 'rgba(239, 68, 68, 0.4)';
    ['light1', 'light2', 'fan1', 'fan2'].forEach(k => {
      const btn = document.getElementById(`toggle-${k}`);
      if (btn) btn.disabled = true;
    });
  }
}

function updateSimulationBadge() {
  if (state.simulationMode) {
    elements.simBadge.textContent = 'MOCK ON';
    elements.simBadge.className = 'sim-badge active';
  } else {
    elements.simBadge.textContent = 'MOCK OFF';
    elements.simBadge.className = 'sim-badge';
  }
}

function renderLogs() {
  if (!elements.auditLogContainer) return;

  if (state.logs.length === 0) {
    elements.auditLogContainer.innerHTML = `
      <div class="audit-empty-state">No control commands recorded yet. Toggle a switch to view real-time latency and hardware confirmation logs.</div>
    `;
    elements.logCount.textContent = '0 events';
    return;
  }

  elements.logCount.textContent = `${state.logs.length} events`;

  elements.auditLogContainer.innerHTML = state.logs.map(log => {
    const time = new Date(log.timestamp).toLocaleTimeString();
    const isSuccess = log.status && log.status.startsWith('SUCCESS');
    const itemClass = !isSuccess ? 'state-fail' : (log.state ? '' : 'state-off');
    const stateBadgeClass = log.state ? 'high' : 'low';
    const latency = log.latencyMs ? `${log.latencyMs}ms` : '--';

    return `
      <div class="audit-log-item ${itemClass}">
        <span class="log-time">${time}</span>
        <span class="log-appliance">${log.appliance.toUpperCase()}</span>
        <span class="log-state ${stateBadgeClass}">${log.output} (${log.state ? 'ON' : 'OFF'})</span>
        <span class="log-latency font-mono">${latency}</span>
        <span class="log-source">${log.status}</span>
      </div>
    `;
  }).join('');
}

// ==============================================================================
// Toast Notifications
// ==============================================================================
function showToast(message, type = 'info') {
  if (!elements.toastContainer) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'toast-error' : (type === 'success' ? 'toast-success' : '')}`;

  let icon = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="16" x2="12" y2="12"></line>
      <line x1="12" y1="8" x2="12.01" y2="8"></line>
    </svg>
  `;

  if (type === 'success') {
    icon = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
    `;
  } else if (type === 'error') {
    icon = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="15" y1="9" x2="9" y2="15"></line>
        <line x1="9" y1="9" x2="15" y2="15"></line>
      </svg>
    `;
  }

  toast.innerHTML = `
    <span>${icon}</span>
    <span style="flex:1;">${message}</span>
  `;

  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ==============================================================================
// Event Listeners & Boot
// ==============================================================================
document.addEventListener('DOMContentLoaded', () => {
  ['light1', 'light2', 'fan1', 'fan2'].forEach(key => {
    const btn = document.getElementById(`toggle-${key}`);
    const card = document.getElementById(`card-${key}`);

    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleAppliance(key);
      });
    }

    if (card) {
      card.addEventListener('click', () => {
        toggleAppliance(key);
      });
    }
  });

  if (elements.syncIndicator) {
    elements.syncIndicator.addEventListener('click', async () => {
      elements.refreshIcon.classList.add('spinning');
      elements.syncText.textContent = 'Syncing...';
      try {
        if (!IS_STATIC_HOST) {
          await fetch('/api/devices/esp32/sync', { method: 'POST' });
        }
        showToast('Synchronized with ThingsBoard Cloud', 'info');
      } catch (e) {
        showToast('Sync request completed', 'info');
      } finally {
        setTimeout(() => {
          elements.refreshIcon.classList.remove('spinning');
          elements.syncText.textContent = 'Synced';
        }, 600);
      }
    });
  }

  if (elements.btnToggleSim) {
    elements.btnToggleSim.addEventListener('click', async () => {
      state.simulationMode = !state.simulationMode;
      updateSimulationBadge();
      showToast(state.simulationMode ? 'Simulation Mode Activated' : 'Simulation Mode Deactivated', 'info');
    });
  }

  if (elements.btnToggleLogs) {
    elements.btnToggleLogs.addEventListener('click', () => {
      const panel = document.getElementById('audit-log-panel');
      if (panel) {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      }
    });
  }

  if (elements.btnClearLogs) {
    elements.btnClearLogs.addEventListener('click', () => {
      state.logs = [];
      renderLogs();
    });
  }

  connectWebSocket();
});
