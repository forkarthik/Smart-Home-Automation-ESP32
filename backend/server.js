/**
 * ==============================================================================
 * ESP32 Smart Home Automation — Production IoT Backend Server
 * ==============================================================================
 * Connects Web Clients to ESP32 Hardware via ThingsBoard Cloud / MQTT & REST API
 * ==============================================================================
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// Configuration
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';
const TB_HOST = process.env.TB_HOST || 'demo.thingsboard.io';
const TB_ACCESS_TOKEN = process.env.TB_ACCESS_TOKEN || 'jk4sujsj9vbbziz4d8al';
const TB_DEVICE_ID = process.env.TB_DEVICE_ID || '1ef3c9f0-bb2a-11f1-9681-6110e8f55c0f';
const COMMAND_TIMEOUT_MS = parseInt(process.env.COMMAND_TIMEOUT_MS || '6000', 10);
let SIMULATION_MODE = process.env.SIMULATION_MODE === 'true';

// Middleware
app.use(cors());
app.use(express.json());
// Serve frontend static build or public folder
app.use(express.static(path.join(__dirname, '../frontend')));

// ==============================================================================
// State & Persistence
// ==============================================================================
const STATE_FILE = path.join(__dirname, 'device_state.json');

const defaultState = {
  device: 'esp32',
  deviceId: TB_DEVICE_ID,
  thingsboardHost: TB_HOST,
  status: 'online', // 'online' or 'offline'
  lastSync: new Date().toISOString(),
  uptime: 0,
  wifiRssi: -60,
  freeHeap: 218000,
  simulationMode: SIMULATION_MODE,
  appliances: {
    light1: { name: 'Light 1', gpio: 16, state: false, output: 'LOW', type: 'light', lastChanged: new Date().toISOString() },
    light2: { name: 'Light 2', gpio: 17, state: false, output: 'LOW', type: 'light', lastChanged: new Date().toISOString() },
    fan1:   { name: 'Fan 1',   gpio: 18, state: false, output: 'LOW', type: 'fan',   lastChanged: new Date().toISOString() },
    fan2:   { name: 'Fan 2',   gpio: 19, state: false, output: 'LOW', type: 'fan',   lastChanged: new Date().toISOString() }
  }
};

let deviceState = { ...defaultState };

// Load persistent state from disk if available
if (fs.existsSync(STATE_FILE)) {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    deviceState = { ...defaultState, ...JSON.parse(raw) };
    deviceState.simulationMode = SIMULATION_MODE;
    console.log('[STORAGE] Loaded persistent device state from disk.');
  } catch (e) {
    console.error('[STORAGE] Error loading state file:', e.message);
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(deviceState, null, 2), 'utf8');
  } catch (e) {
    console.error('[STORAGE] Error saving state:', e.message);
  }
}

// Activity & Audit Logging (keep last 50 events)
const auditLogs = [];
function addAuditLog(action, appliance, state, source, latencyMs = null, status = 'SUCCESS') {
  const logEntry = {
    id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    timestamp: new Date().toISOString(),
    action,
    appliance,
    state,
    output: state ? 'HIGH' : 'LOW',
    source,
    latencyMs,
    status
  };
  auditLogs.unshift(logEntry);
  if (auditLogs.length > 50) auditLogs.pop();
  broadcast({ type: 'AUDIT_LOG', payload: logEntry });
  return logEntry;
}

// ==============================================================================
// WebSocket Management
// ==============================================================================
function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

wss.on('connection', (ws, req) => {
  console.log(`[WS] Client connected from ${req.socket.remoteAddress}`);

  // Send initial full snapshot
  ws.send(JSON.stringify({
    type: 'INITIAL_STATE',
    payload: {
      ...deviceState,
      auditLogs: auditLogs.slice(0, 15)
    }
  }));

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);
      if (msg.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
  });
});

// ==============================================================================
// ThingsBoard Communication Layer
// ==============================================================================
const TB_BASE_URL = `https://${TB_HOST}/api/v1/${TB_ACCESS_TOKEN}`;

/**
 * Sends attribute change to ThingsBoard Cloud.
 * When ThingsBoard receives an attribute update, it forwards it to the ESP32 over MQTT.
 */
async function sendToThingsBoard(applianceKey, targetState) {
  const startTime = Date.now();

  if (SIMULATION_MODE) {
    // In simulation mode, immediately simulate hardware response with realistic 80ms latency
    await new Promise(r => setTimeout(r, 80));
    return { success: true, latency: Date.now() - startTime, simulated: true };
  }

  try {
    // Post to ThingsBoard attributes
    const payload = { [applianceKey]: targetState };
    const resp = await axios.post(`${TB_BASE_URL}/attributes`, payload, { timeout: COMMAND_TIMEOUT_MS });
    const latency = Date.now() - startTime;
    return { success: resp.status === 200, latency, simulated: false };
  } catch (err) {
    console.error(`[THINGSBOARD ERROR] Failed sending to ThingsBoard:`, err.message);
    throw new Error(err.response?.data?.message || err.message || 'ThingsBoard connection error');
  }
}

/**
 * Periodically polls ThingsBoard attributes to detect external state changes (e.g. from ThingsBoard UI or ESP32 reports)
 */
async function syncFromThingsBoard() {
  try {
    const keys = 'light1,light2,fan1,fan2,status,uptime,rssi';
    const resp = await axios.get(`${TB_BASE_URL}/attributes?clientKeys=${keys}&sharedKeys=${keys}`, { timeout: 4000 });
    const data = resp.data || {};
    const attrs = { ...(data.shared || {}), ...(data.client || {}) };

    let stateChanged = false;
    ['light1', 'light2', 'fan1', 'fan2'].forEach(key => {
      if (typeof attrs[key] === 'boolean' && attrs[key] !== deviceState.appliances[key].state) {
        deviceState.appliances[key].state = attrs[key];
        deviceState.appliances[key].output = attrs[key] ? 'HIGH' : 'LOW';
        deviceState.appliances[key].lastChanged = new Date().toISOString();
        stateChanged = true;
      }
    });

    if (attrs.status) deviceState.status = attrs.status;
    if (attrs.uptime) deviceState.uptime = attrs.uptime;
    if (attrs.rssi) deviceState.wifiRssi = attrs.rssi;
    deviceState.lastSync = new Date().toISOString();

    if (stateChanged) {
      saveState();
      broadcast({ type: 'STATE_UPDATE', payload: deviceState });
    }
  } catch (err) {
    // Non-fatal background sync check
  }
}

// Background sync every 5 seconds
setInterval(syncFromThingsBoard, 5000);

// ==============================================================================
// REST API Endpoints
// ==============================================================================

// 1. GET /api/devices/esp32/status
app.get('/api/devices/esp32/status', (req, res) => {
  const activeCount = Object.values(deviceState.appliances).filter(a => a.state).length;
  res.json({
    device: 'esp32',
    deviceId: deviceState.deviceId,
    thingsboardHost: TB_HOST,
    status: deviceState.status,
    online: deviceState.status === 'online',
    uptime: deviceState.uptime,
    wifiRssi: deviceState.wifiRssi,
    freeHeap: deviceState.freeHeap,
    lastSync: deviceState.lastSync,
    activeAppliances: activeCount,
    totalAppliances: 4,
    simulationMode: deviceState.simulationMode
  });
});

// 2. GET /api/devices/esp32/appliances
app.get('/api/devices/esp32/appliances', (req, res) => {
  res.json({
    success: true,
    device: 'esp32',
    timestamp: new Date().toISOString(),
    appliances: deviceState.appliances
  });
});

// 3. POST /api/devices/esp32/appliances/:appliance (light1, light2, fan1, fan2)
app.post('/api/devices/esp32/appliances/:appliance', async (req, res) => {
  const applianceKey = req.params.appliance.toLowerCase();
  const appliance = deviceState.appliances[applianceKey];

  if (!appliance) {
    return res.status(404).json({
      success: false,
      error: `Invalid appliance identifier '${req.params.appliance}'. Supported: light1, light2, fan1, fan2`
    });
  }

  // Determine target state
  let targetState;
  if (typeof req.body.state === 'boolean') {
    targetState = req.body.state;
  } else if (req.body.state === 1 || req.body.state === '1' || req.body.state === 'true') {
    targetState = true;
  } else if (req.body.state === 0 || req.body.state === '0' || req.body.state === 'false') {
    targetState = false;
  } else {
    // If not provided, toggle current state
    targetState = !appliance.state;
  }

  const startTime = Date.now();
  console.log(`[CONTROL] Command received: ${applianceKey} -> ${targetState ? 'ON' : 'OFF'}`);

  try {
    // Dispatch to ThingsBoard (which triggers the ESP32)
    const result = await sendToThingsBoard(applianceKey, targetState);
    const latency = Date.now() - startTime;

    // Update verified local state
    appliance.state = targetState;
    appliance.output = targetState ? 'HIGH' : 'LOW';
    appliance.lastChanged = new Date().toISOString();
    deviceState.lastSync = new Date().toISOString();
    saveState();

    // Log the action
    const log = addAuditLog('SWITCH', applianceKey, targetState, 'Web Dashboard', latency, 'SUCCESS');

    // Broadcast updated state to all connected Web clients
    broadcast({
      type: 'APPLIANCE_STATE_CHANGED',
      payload: {
        appliance: applianceKey,
        name: appliance.name,
        gpio: appliance.gpio,
        state: targetState,
        output: targetState ? 'HIGH' : 'LOW',
        timestamp: appliance.lastChanged,
        latencyMs: latency,
        allAppliances: deviceState.appliances
      }
    });

    return res.json({
      success: true,
      device: 'esp32',
      appliance: applianceKey,
      gpio: appliance.gpio,
      state: targetState,
      output: targetState ? 'HIGH' : 'LOW',
      timestamp: appliance.lastChanged,
      latencyMs: latency,
      simulated: result.simulated
    });
  } catch (error) {
    const latency = Date.now() - startTime;
    console.error(`[CONTROL FAILURE] Could not switch ${applianceKey}:`, error.message);
    addAuditLog('SWITCH', applianceKey, targetState, 'Web Dashboard', latency, 'FAILED: ' + error.message);

    return res.status(504).json({
      success: false,
      error: `Unable to control ${appliance.name}. Hardware or ThingsBoard did not acknowledge in time. Please try again.`,
      details: error.message
    });
  }
});

// 4. GET /api/devices/esp32/logs
app.get('/api/devices/esp32/logs', (req, res) => {
  res.json({
    success: true,
    count: auditLogs.length,
    logs: auditLogs
  });
});

// 5. POST /api/devices/esp32/simulator (Toggle live simulation)
app.post('/api/devices/esp32/simulator', (req, res) => {
  if (typeof req.body.enabled === 'boolean') {
    SIMULATION_MODE = req.body.enabled;
  } else {
    SIMULATION_MODE = !SIMULATION_MODE;
  }
  deviceState.simulationMode = SIMULATION_MODE;
  broadcast({
    type: 'SIMULATION_MODE_CHANGED',
    payload: { simulationMode: SIMULATION_MODE }
  });
  res.json({ success: true, simulationMode: SIMULATION_MODE });
});

// 6. POST /api/devices/esp32/sync (Trigger manual sync)
app.post('/api/devices/esp32/sync', async (req, res) => {
  await syncFromThingsBoard();
  res.json({ success: true, state: deviceState });
});

// 7. GET /api/health
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    clientsConnected: wss.clients.size,
    thingsboard: {
      host: TB_HOST,
      deviceId: TB_DEVICE_ID
    }
  });
});

// ==============================================================================
// Start Server
// ==============================================================================
server.listen(PORT, HOST, () => {
  console.log('==============================================================');
  console.log(`  ESP32 SMART HOME AUTOMATION SERVER RUNNING ON PORT ${PORT} `);
  console.log('==============================================================');
  console.log(`  Local Web Dashboard: http://localhost:${PORT}`);
  console.log(`  ThingsBoard Server:  ${TB_HOST}`);
  console.log(`  Device ID:           ${TB_DEVICE_ID}`);
  console.log(`  Simulation Mode:     ${SIMULATION_MODE ? 'ACTIVE (Fast Mock)' : 'DISABLED (Real Hardware)'}`);
  console.log('==============================================================');
});
