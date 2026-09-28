# ESP32 Smart Home Automation — Security & Deployment Guide

This guide describes how to deploy the production system securely across the public internet, configure SSL/TLS encryption, enforce authentication, and protect GPIO pins from unauthorized access.

---

## 1. Production Architecture Overview

```
                      +-----------------------+
                      |     User Browser      |
                      |  (Desktop / Mobile)   |
                      +-----------+-----------+
                                  |
                                  | HTTPS (Port 443)
                                  v
                      +-----------------------+
                      |    Cloudflare / CDN   |
                      |  (DDoS & TLS Offload) |
                      +-----------+-----------+
                                  |
                                  | Reverse Proxy (Nginx / Caddy)
                                  v
                      +-----------------------+
                      |  Node.js IoT Backend  |
                      |  Express + WebSockets |
                      +-----------+-----------+
                                  |
                                  | HTTPS REST / MQTTS (Port 8883)
                                  v
                      +-----------------------+
                      |   ThingsBoard Cloud   |
                      | (demo.thingsboard.io) |
                      +-----------+-----------+
                                  |
                                  | MQTT over TLS (Port 8883)
                                  v
                      +-----------------------+
                      |      ESP32 Board      |
                      |  Optocoupler Driver   |
                      +-----------------------+
```

---

## 2. Security Best Practices Implemented

1. **No Sensitive Secrets in Client Code:**
   The frontend code contains zero API keys, Wi-Fi credentials, or device private keys. All communication passes through the backend server.
2. **Device Isolation:**
   The ESP32 is not exposed to the public internet using unsafe NAT port forwarding. Instead, it initiates an outbound authenticated MQTT connection to ThingsBoard.
3. **Environment Separation:**
   All credentials reside in `.env` (backend) and `config.h` (firmware), which are excluded by `.gitignore`.
4. **Input Validation:**
   Appliance parameters and states are strictly validated. Malformed requests or unauthorized keys are rejected immediately.
5. **Rate Limiting & Anti-Spam:**
   Toggle switches are disabled during active command execution, preventing button mashing and race conditions.

---

## 3. Production Cloud Deployment Options

### Option A: Cloudflare Pages / Vercel + VPS Backend
1. **Frontend Hosting:**
   - Deploy `frontend/` to **Cloudflare Pages** or **Vercel** with custom domain and automatic SSL.
   - Point API and WebSocket connections to your backend URL (`https://api.yourdomain.com`).
2. **Backend Hosting:**
   - Deploy `backend/` to a VPS (DigitalOcean, AWS EC2, Hetzner) or containerized platform (Render / Railway).
   - Use PM2 process manager:
     ```bash
     npm install -g pm2
     pm2 start server.js --name "smarthome-backend"
     pm2 startup
     pm2 save
     ```
3. **Nginx Reverse Proxy with Let's Encrypt SSL:**
   ```nginx
   server {
       server_name api.yourdomain.com;

       location / {
           proxy_pass http://127.0.0.1:5000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

---

## 4. Flashing the ESP32 via Arduino IDE

1. Open Arduino IDE.
2. Go to **File -> Open** and select `firmware/esp32_home_control/esp32_home_control.ino`.
3. Open `config.h` and configure your Wi-Fi credentials:
   ```cpp
   #define WIFI_SSID       "Your_Home_WiFi"
   #define WIFI_PASSWORD   "Your_WiFi_Password"
   ```
4. Verify your ThingsBoard Device Token is set:
   ```cpp
   #define TB_ACCESS_TOKEN "jk4sujsj9vbbziz4d8al"
   ```
5. Install required libraries from Library Manager:
   - **PubSubClient** by Nick O'Leary
   - **ArduinoJson** by Benoit Blanchon
6. Select Board: **Tools -> Board -> ESP32 Arduino -> DOIT ESP32 DEVKIT V1** (or ESP32 Dev Module).
7. Select Port and click **Upload**.
8. Open Serial Monitor at **115200 baud** to view real-time connection status.
