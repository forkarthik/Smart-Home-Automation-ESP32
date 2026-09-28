/**
 * ============================================================================
 * ESP32 Smart Home Automation - ThingsBoard Configuration Template
 * ============================================================================
 */

#ifndef CONFIG_H
#define CONFIG_H

// 1. Wi-Fi Configuration
#define WIFI_SSID           "YOUR_WIFI_SSID"
#define WIFI_PASSWORD       "YOUR_WIFI_PASSWORD"
#define WIFI_RETRY_INTERVAL_MS 5000

// 2. ThingsBoard Cloud / Server Configuration
#define TB_SERVER           "demo.thingsboard.io"
#define TB_PORT             1883
#define TB_DEVICE_ID        "YOUR_DEVICE_ID"
#define TB_ACCESS_TOKEN     "YOUR_DEVICE_ACCESS_TOKEN"
#define MQTT_CLIENT_ID      "ESP32_SmartHome_Device"

// 3. ThingsBoard MQTT Topics
#define TB_TELEMETRY_TOPIC          "v1/devices/me/telemetry"
#define TB_ATTRIBUTES_TOPIC         "v1/devices/me/attributes"
#define TB_ATTRIBUTES_SUBSCRIBE     "v1/devices/me/attributes/response/+"
#define TB_ATTRIBUTES_UPDATE        "v1/devices/me/attributes"
#define TB_RPC_SUBSCRIBE            "v1/devices/me/rpc/request/+"
#define TB_RPC_RESPONSE_BASE        "v1/devices/me/rpc/response/"

// 4. GPIO Hardware Pin Mapping
#define PIN_LIGHT_1         16   // GPIO 16 -> Light 1
#define PIN_LIGHT_2         17   // GPIO 17 -> Light 2
#define PIN_FAN_1           18   // GPIO 18 -> Fan 1
#define PIN_FAN_2           19   // GPIO 19 -> Fan 2

#define RELAY_ON            HIGH  // 3.3V Logic Level
#define RELAY_OFF           LOW   // 0V Logic Level

// 5. System Timing Constants (ms)
#define TELEMETRY_INTERVAL_MS   15000
#define MQTT_RETRY_INTERVAL_MS  5000

#endif // CONFIG_H
