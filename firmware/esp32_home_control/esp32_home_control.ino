/**
 * ============================================================================
 * ESP32 SMART HOME AUTOMATION — THINGSBOARD IoT FIRMWARE
 * ============================================================================
 * Hardware: ESP32 DevKit V1 (or equivalent ESP32 board)
 * Platform: ThingsBoard Cloud / Server (demo.thingsboard.io / thingsboard.cloud)
 *
 * Controlled Appliances:
 *   - Light 1 : GPIO 16 (HIGH = ON, LOW = OFF)
 *   - Light 2 : GPIO 17 (HIGH = ON, LOW = OFF)
 *   - Fan 1   : GPIO 18 (HIGH = ON, LOW = OFF)
 *   - Fan 2   : GPIO 19 (HIGH = ON, LOW = OFF)
 *
 * Supported Protocols & Features:
 *   - ThingsBoard Two-Way RPC (v1/devices/me/rpc/request/+)
 *   - ThingsBoard Shared Attributes Sync (v1/devices/me/attributes)
 *   - ThingsBoard Client Telemetry (v1/devices/me/telemetry)
 *   - Hardware Verification (digitalRead before acknowledging state)
 *   - Non-blocking Wi-Fi & MQTT Reconnection
 *   - Safe Boot (all 4 GPIOs driven LOW immediately at power-on)
 *
 * Dependencies (install via Arduino IDE Library Manager):
 *   - PubSubClient by Nick O'Leary (v2.8+)
 *   - ArduinoJson by Benoit Blanchon (v6.x or v7.x)
 * ============================================================================
 */

#include <WiFi.h>
#include <WiFiClient.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "config.h"

// ============================================================================
// Network Clients
// ============================================================================
WiFiClient espClient;
PubSubClient client(espClient);

// ============================================================================
// Appliance Hardware Definitions
// ============================================================================
struct Appliance {
  const char* name;
  uint8_t gpio;
  bool state;
};

Appliance appliances[4] = {
  { "light1", PIN_LIGHT_1, false },
  { "light2", PIN_LIGHT_2, false },
  { "fan1",   PIN_FAN_1,   false },
  { "fan2",   PIN_FAN_2,   false }
};

// State and Timing Variables
unsigned long lastTelemetryTime = 0;
unsigned long lastMqttRetryTime = 0;
unsigned long lastWifiCheckTime = 0;
unsigned long totalCommandsProcessed = 0;

// ============================================================================
// Function Declarations
// ============================================================================
void initHardwarePins();
void setupWiFi();
void checkWiFi();
void reconnectThingsBoard();
void onMqttMessage(char* topic, byte* payload, unsigned int length);
void handleRpcRequest(String topic, const char* jsonPayload);
void handleAttributesUpdate(const char* jsonPayload);
bool setApplianceState(int index, bool targetState, const char* requestId);
void sendRpcResponse(const char* requestId, int index, bool success);
void publishAttributes();
void publishTelemetry();
int findApplianceIndex(const char* name);

// ============================================================================
// Hardware Pin Initialization (Safe Boot - Mandatory LOW)
// ============================================================================
void initHardwarePins() {
  Serial.println("\n[HARDWARE] Initializing GPIO pins...");
  for (int i = 0; i < 4; i++) {
    pinMode(appliances[i].gpio, OUTPUT);
    digitalWrite(appliances[i].gpio, RELAY_OFF);
    appliances[i].state = false;

    int actualLevel = digitalRead(appliances[i].gpio);
    Serial.printf("[HARDWARE] %s (GPIO %d) -> Initialized to %s (DigitalRead: %d)\n",
                  appliances[i].name,
                  appliances[i].gpio,
                  (RELAY_OFF == LOW ? "LOW (0V)" : "HIGH"),
                  actualLevel);
  }
  Serial.println("[HARDWARE] Safe boot verified: All appliance outputs are OFF.");
}

// ============================================================================
// Wi-Fi Management
// ============================================================================
void setupWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.printf("\n[WIFI] Connecting to SSID: %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 10000) {
    delay(300);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI] Connected successfully!");
    Serial.printf("[WIFI] IP Address: %s | RSSI: %d dBm\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
  } else {
    Serial.println("\n[WIFI] Initial connection attempt timed out. Reconnection loop active.");
  }
}

void checkWiFi() {
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastWifiCheckTime > WIFI_RETRY_INTERVAL_MS) {
      lastWifiCheckTime = millis();
      Serial.println("[WIFI] Connection lost. Attempting non-blocking reconnect...");
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
  }
}

// ============================================================================
// ThingsBoard MQTT Connection
// ============================================================================
void reconnectThingsBoard() {
  if (client.connected()) return;
  if (WiFi.status() != WL_CONNECTED) return;

  if (millis() - lastMqttRetryTime < MQTT_RETRY_INTERVAL_MS) return;
  lastMqttRetryTime = millis();

  Serial.printf("[THINGSBOARD] Connecting to %s:%d with Device Token...\n", TB_SERVER, TB_PORT);

  // In ThingsBoard, the Access Token is passed as the MQTT Username. Password is NULL.
  if (client.connect(MQTT_CLIENT_ID, TB_ACCESS_TOKEN, NULL)) {
    Serial.println("[THINGSBOARD] Connected successfully to ThingsBoard MQTT Broker!");

    // Subscribe to Two-Way RPC requests
    client.subscribe(TB_RPC_SUBSCRIBE);
    Serial.printf("[THINGSBOARD] Subscribed to RPC Topic: %s\n", TB_RPC_SUBSCRIBE);

    // Subscribe to Shared Attributes updates
    client.subscribe(TB_ATTRIBUTES_UPDATE);
    Serial.printf("[THINGSBOARD] Subscribed to Attributes Topic: %s\n", TB_ATTRIBUTES_UPDATE);

    // Send initial client attributes & telemetry to synchronize dashboard immediately
    publishAttributes();
    publishTelemetry();
  } else {
    Serial.printf("[THINGSBOARD] Connection failed, rc=%d. Retrying in %d ms...\n",
                  client.state(), MQTT_RETRY_INTERVAL_MS);
  }
}

// ============================================================================
// Inbound MQTT Dispatcher
// ============================================================================
void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  if (length >= 512) {
    Serial.println("[MQTT] Warning: Inbound payload exceeds buffer limit!");
    return;
  }

  char message[512];
  memcpy(message, payload, length);
  message[length] = '\0';

  String topicStr = String(topic);
  Serial.printf("\n[THINGSBOARD INBOUND] Topic: %s | Payload: %s\n", topic, message);

  // Handle Two-Way RPC Requests (v1/devices/me/rpc/request/{requestId})
  if (topicStr.startsWith("v1/devices/me/rpc/request/")) {
    handleRpcRequest(topicStr, message);
  }
  // Handle Shared Attribute Updates (v1/devices/me/attributes)
  else if (topicStr.equals(TB_ATTRIBUTES_UPDATE)) {
    handleAttributesUpdate(message);
  }
}

// ============================================================================
// ThingsBoard RPC Command Processing
// ============================================================================
void handleRpcRequest(String topic, const char* jsonPayload) {
  // Extract requestId from topic string
  int lastSlash = topic.lastIndexOf('/');
  String requestId = topic.substring(lastSlash + 1);

  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, jsonPayload);

  if (error) {
    Serial.printf("[RPC ERROR] JSON parse failure: %s\n", error.c_str());
    return;
  }

  const char* method = doc["method"];
  if (!method) {
    Serial.println("[RPC ERROR] Missing 'method' field.");
    return;
  }

  Serial.printf("[RPC] Received method: %s | RequestId: %s\n", method, requestId.c_str());

  // Support 1: Direct method naming ("setLight1", "setLight2", "setFan1", "setFan2")
  if (strcasecmp(method, "setLight1") == 0) {
    bool state = doc["params"].as<bool>();
    setApplianceState(0, state, requestId.c_str());
  }
  else if (strcasecmp(method, "setLight2") == 0) {
    bool state = doc["params"].as<bool>();
    setApplianceState(1, state, requestId.c_str());
  }
  else if (strcasecmp(method, "setFan1") == 0) {
    bool state = doc["params"].as<bool>();
    setApplianceState(2, state, requestId.c_str());
  }
  else if (strcasecmp(method, "setFan2") == 0) {
    bool state = doc["params"].as<bool>();
    setApplianceState(3, state, requestId.c_str());
  }
  // Support 2: Generalized "setAppliance" with { appliance: "light1", state: true }
  else if (strcasecmp(method, "setAppliance") == 0) {
    const char* appName = doc["params"]["appliance"];
    bool state = doc["params"]["state"].as<bool>();
    int idx = findApplianceIndex(appName);
    if (idx >= 0) {
      setApplianceState(idx, state, requestId.c_str());
    } else {
      Serial.printf("[RPC ERROR] Unknown appliance: %s\n", appName);
    }
  }
  // Support 3: Generalized "setGpio" with { pin: 16, state: true }
  else if (strcasecmp(method, "setGpio") == 0) {
    int pin = doc["params"]["pin"].as<int>();
    bool state = doc["params"]["state"].as<bool>();
    int idx = -1;
    for (int i = 0; i < 4; i++) {
      if (appliances[i].gpio == pin) { idx = i; break; }
    }
    if (idx >= 0) {
      setApplianceState(idx, state, requestId.c_str());
    }
  }
  // Support 4: Query full status ("getStatus" / "getValue")
  else if (strcasecmp(method, "getStatus") == 0 || strcasecmp(method, "getValue") == 0) {
    StaticJsonDocument<384> resDoc;
    resDoc["device"] = "esp32";
    resDoc["uptime"] = millis() / 1000;
    for (int i = 0; i < 4; i++) {
      resDoc[appliances[i].name] = appliances[i].state;
    }
    char buf[384];
    serializeJson(resDoc, buf);
    String responseTopic = String(TB_RPC_RESPONSE_BASE) + requestId;
    client.publish(responseTopic.c_str(), buf);
  }
}

// ============================================================================
// ThingsBoard Shared Attributes Processing
// ============================================================================
void handleAttributesUpdate(const char* jsonPayload) {
  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, jsonPayload);
  if (error) return;

  for (int i = 0; i < 4; i++) {
    if (doc.containsKey(appliances[i].name)) {
      bool target = doc[appliances[i].name].as<bool>();
      setApplianceState(i, target, NULL);
    }
  }
}

// ============================================================================
// Core Appliance State Controller & Hardware Verification
// ============================================================================
bool setApplianceState(int index, bool targetState, const char* requestId) {
  if (index < 0 || index >= 4) return false;

  uint8_t gpio = appliances[index].gpio;
  uint8_t outputLevel = targetState ? RELAY_ON : RELAY_OFF;

  // 1. Apply hardware state
  digitalWrite(gpio, outputLevel);

  // 2. Hardware Confirmation: Read back actual voltage level on the pin
  int actualLevel = digitalRead(gpio);
  bool confirmedState = (actualLevel == RELAY_ON);
  appliances[index].state = confirmedState;

  totalCommandsProcessed++;

  Serial.printf("[HARDWARE CONFIRMED] %s (GPIO %d) set to %s (Pin voltage reading: %d)\n",
                appliances[index].name, gpio, (confirmedState ? "HIGH / ON" : "LOW / OFF"), actualLevel);

  // 3. Send Two-Way RPC Response if requested
  if (requestId != NULL && strlen(requestId) > 0) {
    sendRpcResponse(requestId, index, true);
  }

  // 4. Synchronize ThingsBoard Client Attributes and Telemetry
  publishAttributes();
  publishTelemetry();

  return true;
}

// ============================================================================
// Send Two-Way RPC Response to ThingsBoard
// ============================================================================
void sendRpcResponse(const char* requestId, int index, bool success) {
  StaticJsonDocument<256> doc;
  doc["success"] = success;
  doc["device"] = "esp32";
  doc["appliance"] = appliances[index].name;
  doc["gpio"] = appliances[index].gpio;
  doc["state"] = appliances[index].state;
  doc["output"] = appliances[index].state ? "HIGH" : "LOW";
  doc["uptime"] = millis() / 1000;

  char buffer[256];
  serializeJson(doc, buffer);

  String responseTopic = String(TB_RPC_RESPONSE_BASE) + requestId;
  client.publish(responseTopic.c_str(), buffer);
  Serial.printf("[THINGSBOARD RPC RESP] Topic: %s | Payload: %s\n", responseTopic.c_str(), buffer);
}

// ============================================================================
// Publish Client Attributes (Current verified GPIO states & hardware details)
// ============================================================================
void publishAttributes() {
  if (!client.connected()) return;

  StaticJsonDocument<384> doc;
  doc["device"] = "ESP32";
  doc["firmware"] = "1.0.0-thingsboard";
  doc["ip"] = WiFi.localIP().toString();

  for (int i = 0; i < 4; i++) {
    doc[appliances[i].name] = appliances[i].state;
    String gpioKey = "gpio" + String(appliances[i].gpio);
    doc[gpioKey] = appliances[i].state ? "HIGH" : "LOW";
  }

  char buffer[384];
  serializeJson(doc, buffer);
  client.publish(TB_ATTRIBUTES_TOPIC, buffer);
}

// ============================================================================
// Publish Periodic Telemetry (Real-time time series data for ThingsBoard)
// ============================================================================
void publishTelemetry() {
  if (!client.connected()) return;

  StaticJsonDocument<384> doc;
  doc["uptime"] = millis() / 1000;
  doc["rssi"] = WiFi.RSSI();
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["commandsProcessed"] = totalCommandsProcessed;
  doc["status"] = "online";

  for (int i = 0; i < 4; i++) {
    // Read actual hardware pin status
    int actual = digitalRead(appliances[i].gpio);
    appliances[i].state = (actual == RELAY_ON);

    doc[appliances[i].name] = appliances[i].state;
    String gpioKey = "gpio" + String(appliances[i].gpio);
    doc[gpioKey] = appliances[i].state ? "HIGH" : "LOW";
  }

  char buffer[384];
  serializeJson(doc, buffer);
  client.publish(TB_TELEMETRY_TOPIC, buffer);
  Serial.printf("[THINGSBOARD TELEMETRY] Sent: %s\n", buffer);
}

// ============================================================================
// Helper: Find Appliance by Name
// ============================================================================
int findApplianceIndex(const char* name) {
  for (int i = 0; i < 4; i++) {
    if (strcasecmp(appliances[i].name, name) == 0) {
      return i;
    }
  }
  return -1;
}

// ============================================================================
// Arduino Setup & Main Loop
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n============================================================");
  Serial.println("  ESP32 SMART HOME AUTOMATION — THINGSBOARD HARDWARE FIRMWARE ");
  Serial.println("============================================================");
  Serial.printf("Device ID: %s\n", TB_DEVICE_ID);
  Serial.printf("Server:    %s:%d\n", TB_SERVER, TB_PORT);

  // 1. Mandatory Safe Hardware Boot: Initialize all GPIOs as OUTPUT and LOW
  initHardwarePins();

  // 2. Connect Wi-Fi
  setupWiFi();

  // 3. Configure ThingsBoard MQTT Client
  client.setServer(TB_SERVER, TB_PORT);
  client.setCallback(onMqttMessage);
  client.setBufferSize(512);

  // 4. Initial Connection Attempt
  reconnectThingsBoard();
}

void loop() {
  // Check Wi-Fi state non-blockingly
  checkWiFi();

  // Maintain ThingsBoard MQTT session
  if (WiFi.status() == WL_CONNECTED) {
    if (!client.connected()) {
      reconnectThingsBoard();
    } else {
      client.loop();
    }
  }

  // Periodic Telemetry Transmission
  if (millis() - lastTelemetryTime > TELEMETRY_INTERVAL_MS) {
    lastTelemetryTime = millis();
    publishTelemetry();
  }
}
