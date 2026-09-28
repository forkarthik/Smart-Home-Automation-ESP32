# ESP32 Smart Home Automation — ThingsBoard IoT Web Control System

A production-ready, full-stack Smart Home Automation platform designed to control four real-world electrical appliances connected to an ESP32 microcontroller over the public internet, powered by the **ThingsBoard Cloud IoT Engine**.

---

## 🌟 System Highlights

- **Real Hardware Pin Control:**
  - **Light 1:** GPIO 16 (HIGH = ON / 3.3V, LOW = OFF / 0V)
  - **Light 2:** GPIO 17 (HIGH = ON / 3.3V, LOW = OFF / 0V)
  - **Fan 1:** GPIO 18 (HIGH = ON / 3.3V, LOW = OFF / 0V)
  - **Fan 2:** GPIO 19 (HIGH = ON / 3.3V, LOW = OFF / 0V)
- **ThingsBoard Integration:**
  - Host: `demo.thingsboard.io` (Port 1883)
  - Verified Device ID: `1ef3c9f0-bb2a-11f1-9681-6110e8f55c0f`
  - Access Token: `jk4sujsj9vbbziz4d8al`
  - Two-Way RPC (`v1/devices/me/rpc/request/+`) & Shared Attributes sync.
- **Apple Home & Samsung SmartThings Inspired Aesthetics:**
  - Modern dark charcoal/navy glassmorphic UI (`#070a12`).
  - Glowing ambient radial lighting and radiant active card states.
  - Interactive multi-blade spinning animation for Fans when active.
  - In-flight switch loading spinners preventing duplicate clicks.
  - Real-time Hardware & Network Audit Trail with round-trip latency tracking.
- **Strict Hardware Safety:**
  - Safe Boot guarantees: All 4 GPIO pins are driven LOW (0V) immediately upon boot.
  - State read-back: Verifies voltage level with `digitalRead()` before acknowledging commands.
  - Non-blocking Wi-Fi & MQTT reconnection.

---

## 📁 Repository Structure

```
Home Automation/
├── backend/
│   ├── .env                      # Active environment configuration
│   ├── .env.example              # Environment template
│   ├── server.js                 # Production Express + WebSocket IoT backend
│   ├── simulator.js              # ESP32 virtual hardware MQTT emulator
│   ├── package.json              # Backend dependencies
│   └── device_state.json         # Persistent state cache
├── frontend/
│   ├── index.html                # Responsive Smart Home dashboard HTML
│   ├── style.css                 # Dark glassmorphism & animation styles
│   └── app.js                    # Bidirectional WebSocket & REST client
├── firmware/
│   └── esp32_home_control/
│       ├── esp32_home_control.ino # Arduino C++ firmware for ESP32
│       ├── config.h              # Active Wi-Fi & ThingsBoard configuration
│       └── config.example.h      # Firmware configuration template
├── docs/
│   ├── WIRING_AND_HARDWARE_GUIDE.md  # Optocoupler relay wiring & AC isolation
│   ├── API_DOCUMENTATION.md      # REST, WebSocket, & MQTT API schemas
│   ├── SECURITY_AND_DEPLOYMENT.md# Cloud deployment & SSL setup
│   └── TESTING_CHECKLIST.md      # 12-point engineering test verification
└── README.md
```

---

## 🚀 Quick Start Guide

### 1. Run the Backend & Web Dashboard Locally
The backend is currently running on port **5000**.
Open your browser and navigate to:
```
http://localhost:5000
```

To start or restart the backend server manually:
```bash
cd backend
node server.js
```

### 2. Flashing the ESP32 Hardware
1. Open the Arduino IDE.
2. Open `firmware/esp32_home_control/esp32_home_control.ino`.
3. In `config.h`, set your 2.4GHz Wi-Fi credentials:
   ```cpp
   #define WIFI_SSID     "Your_WiFi_SSID"
   #define WIFI_PASSWORD "Your_WiFi_Password"
   ```
4. Install **PubSubClient** and **ArduinoJson** from the Arduino Library Manager.
5. Connect your ESP32 board via USB, choose your COM port, and click **Upload**.
6. Open the Serial Monitor at **115200 baud** to see real-time hardware boot, Wi-Fi connection, and ThingsBoard MQTT connection messages.

### 3. Optional: ESP32 Hardware Simulator
If your physical ESP32 board is not yet plugged in or you want to run automated tests:
```bash
cd backend
node simulator.js
```
The simulator connects to ThingsBoard using your genuine token, emulates GPIO 16-19, and logs virtual pin changes.

---

## 🔌 Hardware Pinout Summary

| Appliance | ESP32 Pin | Logic ON | Logic OFF | Relay Driver |
| :--- | :--- | :--- | :--- | :--- |
| **Light 1** | **GPIO 16** | HIGH (3.3V) | LOW (0V) | Channel 1 Optocoupler Relay |
| **Light 2** | **GPIO 17** | HIGH (3.3V) | LOW (0V) | Channel 2 Optocoupler Relay |
| **Fan 1** | **GPIO 18** | HIGH (3.3V) | LOW (0V) | Channel 3 Optocoupler Relay + RC Snubber |
| **Fan 2** | **GPIO 19** | HIGH (3.3V) | LOW (0V) | Channel 4 Optocoupler Relay + RC Snubber |

Refer to [docs/WIRING_AND_HARDWARE_GUIDE.md](file:///c:/Users/Admin/Desktop/Home%20Automation/docs/WIRING_AND_HARDWARE_GUIDE.md) for full isolation schematics and AC safety procedures.
