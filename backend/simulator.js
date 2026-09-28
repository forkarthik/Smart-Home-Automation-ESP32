/**
 * ==============================================================================
 * ESP32 VIRTUAL HARDWARE SIMULATOR FOR THINGSBOARD
 * ==============================================================================
 * Connects to demo.thingsboard.io via MQTT using the genuine device credentials.
 * Simulates ESP32 GPIO 16, 17, 18, 19, replies to RPC calls, and sends telemetry.
 * ==============================================================================
 */

const mqtt = require('mqtt');
require('dotenv').config();

const TB_HOST = process.env.TB_HOST || 'demo.thingsboard.io';
const TB_PORT = process.env.TB_PORT || 1883;
const TB_ACCESS_TOKEN = process.env.TB_ACCESS_TOKEN || 'jk4sujsj9vbbziz4d8al';
const TB_DEVICE_ID = process.env.TB_DEVICE_ID || '1ef3c9f0-bb2a-11f1-9681-6110e8f55c0f';

console.log('==============================================================');
console.log('  STARTING ESP32 VIRTUAL HARDWARE EMULATOR                    ');
console.log('==============================================================');
console.log(`Connecting to ThingsBoard Broker: mqtt://${TB_HOST}:${TB_PORT}`);
console.log(`Device ID:    ${TB_DEVICE_ID}`);
console.log(`Access Token: ${TB_ACCESS_TOKEN}`);

// Virtual Hardware State
const virtualHardware = {
  light1: { pin: 16, name: 'Light 1', state: false },
  light2: { pin: 17, name: 'Light 2', state: false },
  fan1:   { pin: 18, name: 'Fan 1',   state: false },
  fan2:   { pin: 19, name: 'Fan 2',   state: false }
};

let uptimeSeconds = 0;
setInterval(() => uptimeSeconds++, 1000);

const client = mqtt.connect(`mqtt://${TB_HOST}:${TB_PORT}`, {
  username: TB_ACCESS_TOKEN,
  password: '',
  clientId: 'ESP32_SIMULATOR_' + Math.random().toString(16).substr(2, 6)
});

client.on('connect', () => {
  console.log('[SIMULATOR] Successfully connected to ThingsBoard MQTT Broker!');

  // Subscribe to RPC commands
  client.subscribe('v1/devices/me/rpc/request/+', (err) => {
    if (!err) console.log('[SIMULATOR] Subscribed to RPC requests: v1/devices/me/rpc/request/+');
  });

  // Subscribe to Attributes
  client.subscribe('v1/devices/me/attributes', (err) => {
    if (!err) console.log('[SIMULATOR] Subscribed to Attributes: v1/devices/me/attributes');
  });

  // Send initial startup telemetry
  publishTelemetry();
});

client.on('message', (topic, message) => {
  const str = message.toString();
  console.log(`\n[INCOMING MQTT] Topic: ${topic}\nPayload: ${str}`);

  if (topic.startsWith('v1/devices/me/rpc/request/')) {
    const requestId = topic.split('/').pop();
    try {
      const data = JSON.parse(str);
      const method = data.method;
      console.log(`[RPC INVOKE] Method: ${method} | RequestId: ${requestId}`);

      let targetApp = null;
      let targetState = false;

      if (method === 'setLight1') { targetApp = 'light1'; targetState = Boolean(data.params); }
      else if (method === 'setLight2') { targetApp = 'light2'; targetState = Boolean(data.params); }
      else if (method === 'setFan1') { targetApp = 'fan1'; targetState = Boolean(data.params); }
      else if (method === 'setFan2') { targetApp = 'fan2'; targetState = Boolean(data.params); }

      if (targetApp && virtualHardware[targetApp]) {
        virtualHardware[targetApp].state = targetState;
        const pin = virtualHardware[targetApp].pin;
        console.log(`[GPIO HARDWARE] Pin GPIO ${pin} driven to ${targetState ? 'HIGH (3.3V)' : 'LOW (0V)'}`);

        // Send RPC Response
        const responsePayload = JSON.stringify({
          success: true,
          device: 'esp32',
          appliance: targetApp,
          gpio: pin,
          state: targetState,
          output: targetState ? 'HIGH' : 'LOW',
          uptime: uptimeSeconds
        });
        client.publish(`v1/devices/me/rpc/response/${requestId}`, responsePayload);
        console.log(`[RPC RESPONSE] Published to v1/devices/me/rpc/response/${requestId}`);

        publishTelemetry();
      }
    } catch (e) {
      console.error('[SIMULATOR ERROR] JSON parse failure:', e.message);
    }
  } else if (topic === 'v1/devices/me/attributes') {
    try {
      const attrs = JSON.parse(str);
      Object.keys(attrs).forEach(key => {
        if (virtualHardware[key]) {
          virtualHardware[key].state = Boolean(attrs[key]);
          console.log(`[SHARED ATTR] ${key} (GPIO ${virtualHardware[key].pin}) updated to ${attrs[key] ? 'HIGH' : 'LOW'}`);
        }
      });
      publishTelemetry();
    } catch (e) {}
  }
});

function publishTelemetry() {
  const telemetry = {
    uptime: uptimeSeconds,
    status: 'online',
    rssi: -58,
    freeHeap: 219400,
    light1: virtualHardware.light1.state,
    light2: virtualHardware.light2.state,
    fan1: virtualHardware.fan1.state,
    fan2: virtualHardware.fan2.state,
    gpio16: virtualHardware.light1.state ? 'HIGH' : 'LOW',
    gpio17: virtualHardware.light2.state ? 'HIGH' : 'LOW',
    gpio18: virtualHardware.fan1.state ? 'HIGH' : 'LOW',
    gpio19: virtualHardware.fan2.state ? 'HIGH' : 'LOW'
  };
  client.publish('v1/devices/me/telemetry', JSON.stringify(telemetry));
  client.publish('v1/devices/me/attributes', JSON.stringify(telemetry));
}

// Periodic telemetry every 15 seconds
setInterval(publishTelemetry, 15000);

client.on('error', (err) => {
  console.error('[SIMULATOR ERROR]', err.message);
});
