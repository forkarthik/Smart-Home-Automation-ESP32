# ESP32 Smart Home Automation — API Documentation

This document describes the REST API, WebSocket protocol, and ThingsBoard MQTT architecture implemented for the ESP32 Smart Home IoT Control System.

---

## 1. REST API Endpoints

**Base URL:** `http://<SERVER_HOST>:5000` (or `https://<DOMAIN>` in production)

### 1.1 Device Overall Status
- **Method:** `GET`
- **Route:** `/api/devices/esp32/status`
- **Description:** Returns the live connection status, hardware metrics, active appliance counts, and synchronization timestamp.

#### Response (200 OK):
```json
{
  "device": "esp32",
  "deviceId": "1ef3c9f0-bb2a-11f1-9681-6110e8f55c0f",
  "thingsboardHost": "demo.thingsboard.io",
  "status": "online",
  "online": true,
  "uptime": 1240,
  "wifiRssi": -58,
  "freeHeap": 218400,
  "lastSync": "2026-09-28T10:55:50.482Z",
  "activeAppliances": 1,
  "totalAppliances": 4,
  "simulationMode": false
}
```

---

### 1.2 Get All Appliances
- **Method:** `GET`
- **Route:** `/api/devices/esp32/appliances`
- **Description:** Returns all four appliance states, GPIO pin numbers, output voltage levels, and timestamps.

#### Response (200 OK):
```json
{
  "success": true,
  "device": "esp32",
  "timestamp": "2026-09-28T10:55:54.581Z",
  "appliances": {
    "light1": {
      "name": "Light 1",
      "gpio": 16,
      "state": false,
      "output": "LOW",
      "type": "light",
      "lastChanged": "2026-09-28T10:53:40.154Z"
    },
    "light2": {
      "name": "Light 2",
      "gpio": 17,
      "state": false,
      "output": "LOW",
      "type": "light",
      "lastChanged": "2026-09-28T10:53:40.154Z"
    },
    "fan1": {
      "name": "Fan 1",
      "gpio": 18,
      "state": true,
      "output": "HIGH",
      "type": "fan",
      "lastChanged": "2026-09-28T10:55:59.026Z"
    },
    "fan2": {
      "name": "Fan 2",
      "gpio": 19,
      "state": false,
      "output": "LOW",
      "type": "fan",
      "lastChanged": "2026-09-28T10:53:40.154Z"
    }
  }
}
```

---

### 1.3 Control Appliance State
- **Method:** `POST`
- **Route:** `/api/devices/esp32/appliances/:appliance`
  - Valid `:appliance` values: `light1`, `light2`, `fan1`, `fan2`
- **Description:** Sends control request to the physical ESP32 via ThingsBoard. Waits for confirmation before responding.

#### Request Body:
```json
{
  "state": true
}
```
*(Passing `state: true` requests ON / HIGH, `state: false` requests OFF / LOW. Omitting `state` toggles current state).*

#### Response (200 OK — Confirmed):
```json
{
  "success": true,
  "device": "esp32",
  "appliance": "light1",
  "gpio": 16,
  "state": true,
  "output": "HIGH",
  "timestamp": "2026-09-28T10:55:56.710Z",
  "latencyMs": 285,
  "simulated": false
}
```

#### Error Response (504 Gateway Timeout):
```json
{
  "success": false,
  "error": "Unable to control Light 1. Hardware or ThingsBoard did not acknowledge in time. Please try again.",
  "details": "timeout of 6000ms exceeded"
}
```

---

### 1.4 Audit Trail & Logs
- **Method:** `GET`
- **Route:** `/api/devices/esp32/logs`
- **Description:** Returns the chronological audit trail of all commands, latencies, and execution statuses.

---

### 1.5 System Health
- **Method:** `GET`
- **Route:** `/api/health`
- **Description:** Server liveness probe and active WebSocket connections.

---

## 2. WebSocket Real-Time Protocol

**WebSocket URL:** `ws://<SERVER_HOST>:5000/ws` (or `wss://<DOMAIN>/ws`)

### 2.1 Inbound Messages (Server -> Browser Client)

#### `INITIAL_STATE`
Sent immediately upon client connection:
```json
{
  "type": "INITIAL_STATE",
  "payload": {
    "device": "esp32",
    "status": "online",
    "appliances": { ... },
    "auditLogs": [ ... ]
  }
}
```

#### `APPLIANCE_STATE_CHANGED`
Broadcasted to all open browser sessions when an appliance state is confirmed:
```json
{
  "type": "APPLIANCE_STATE_CHANGED",
  "payload": {
    "appliance": "light1",
    "name": "Light 1",
    "gpio": 16,
    "state": true,
    "output": "HIGH",
    "timestamp": "2026-09-28T10:55:56.710Z",
    "latencyMs": 285,
    "allAppliances": { ... }
  }
}
```

---

## 3. ThingsBoard MQTT Protocol

| Channel | MQTT Topic | Direction | Content |
| :--- | :--- | :--- | :--- |
| **RPC Requests** | `v1/devices/me/rpc/request/+` | Inbound to ESP32 | `{"method": "setLight1", "params": true}` |
| **RPC Response** | `v1/devices/me/rpc/response/{id}` | Outbound from ESP32 | `{"success": true, "gpio": 16, "state": true, "output": "HIGH"}` |
| **Shared Attributes** | `v1/devices/me/attributes` | Bi-directional | `{"light1": true, "light2": false}` |
| **Telemetry** | `v1/devices/me/telemetry` | Outbound from ESP32 | `{"uptime": 120, "rssi": -58, "freeHeap": 218000}` |
