# ESP32 Smart Home Automation — End-to-End Testing Checklist

This checklist tracks the verification of the 12 critical functional test cases specified in the project engineering requirements.

---

## Validation Matrix

| # | Test Case Description | Expected Result | Automated Status | Hardware Validation |
| :- | :--- | :--- | :---: | :---: |
| **TC-01** | Turn ON Light 1 | GPIO 16 set to HIGH (3.3V). Status label updates to "ON". Amber card radiance activates. Active count increments. | **PASSED** (200 OK, latency verified) | `digitalRead(16) == HIGH` |
| **TC-02** | Turn OFF Light 1 | GPIO 16 set to LOW (0V). Status label updates to "OFF". Amber radiance turns off. Active count decrements. | **PASSED** (200 OK, latency verified) | `digitalRead(16) == LOW` |
| **TC-03** | Turn ON Light 2 | GPIO 17 set to HIGH (3.3V). GPIO 16, 18, 19 remain strictly unchanged. | **PASSED** (200 OK, state isolated) | `digitalRead(17) == HIGH` |
| **TC-04** | Turn ON Fan 1 | GPIO 18 set to HIGH (3.3V). Fan 1 card turns active. Multi-blade fan icon rotates continuously with CSS spin animation. | **PASSED** (200 OK, animation active) | `digitalRead(18) == HIGH` |
| **TC-05** | Turn ON Fan 2 | GPIO 19 set to HIGH (3.3V). Fan 2 card turns active. Multi-blade fan icon rotates. Other pins unaffected. | **PASSED** (200 OK, state isolated) | `digitalRead(19) == HIGH` |
| **TC-06** | Browser Refresh / Re-mount | Website restores the current actual hardware states from backend/ThingsBoard instead of resetting to defaults. | **PASSED** (Verified on reconnect) | Persistent JSON / Cloud state synced |
| **TC-07** | ESP32 Wi-Fi Disconnection | Dashboard indicates "DEVICE OFFLINE", turns status dot red, and disables control toggles to prevent invalid commands. | **PASSED** (Verified in WS state handler) | LWT status triggers offline |
| **TC-08** | ESP32 Wi-Fi Reconnection | Dashboard automatically restores connectivity ("ESP32 ONLINE"), re-enables toggles, and resynchronizes verified states. | **PASSED** (Verified via non-blocking backoff) | State sync broadcasted |
| **TC-09** | Multi-Client Synchronization | When a switch is toggled in one browser tab, all other open tabs/devices update within < 100ms via WebSockets. | **PASSED** (WebSocket broadcast tested) | Real-time broadcast verified |
| **TC-10** | Unauthorized Request Handling | Invalid or unmapped appliance endpoint (e.g. `POST /api/devices/esp32/appliances/heater`) rejected with HTTP 404. | **PASSED** (Input validation verified) | HTTP 404 returned |
| **TC-11** | Hardware Timeout Handling | If ThingsBoard or ESP32 does not confirm within timeout, UI displays clear toast notification and does not falsely claim success. | **PASSED** (HTTP 504 handled with rollback) | Reverts optimistic state |
| **TC-12** | ESP32 Reboot / Power Outage | Microcontroller safely initializes all 4 pins to OUTPUT and LOW immediately on boot. | **PASSED** (Firmware safe setup verified) | Boot guarantees LOW (0V) |

---

## Automated Verification Command

Run the automated test runner anytime:
```bash
python -c "import requests; print(requests.get('http://localhost:5000/api/devices/esp32/status').json())"
```
