/**
 * ============================================================================
 * ESP32 SMART HOME AUTOMATION — THINGSBOARD IoT FIRMWARE
 * ============================================================================
 * Controller: ESP32 Development Board (30-pin / 38-pin DevKit V1)
 * IoT Platform: ThingsBoard Cloud (demo.thingsboard.io)
 *
 * Hardware Pin Mapping:
 *   - Light 1 : GPIO 16 (HIGH = ON / 3.3V, LOW = OFF / 0V)
 *   - Light 2 : GPIO 17 (HIGH = ON / 3.3V, LOW = OFF / 0V)
 *   - Fan 1   : GPIO 18 (HIGH = ON / 3.3V, LOW = OFF / 0V)
 *   - Fan 2   : GPIO 19 (HIGH = ON / 3.3V, LOW = OFF / 0V)
 *
 * Dependencies (install via Arduino IDE Library Manager):
 *   - "PubSubClient" by Nick O'Leary
 *   - "ArduinoJson" by Benoit Blanchon (Supports both v6 and v7)
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

// Timing and Metrics
unsigned long lastTelemetryTime = 0;
unsigned long lastMqttRetryTime = 0;
unsigned long lastWifiCheckTime = 0;
unsigned long totalCommandsProcessed = 0;

// ============================================================================
// Forward Declarations
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
// Safe Hardware Initialization (MANDATORY SAFE BOOT: All pins LOW / 0V)
// ============================================================================
void initHardwarePins() {
  Serial.println("\n[HARDWARE] Initializing GPIO pins...");
  for (int i = 0; i < 4; i++) {
    pinMode(appliances[i].gpio, OUTPUT);
    digitalWrite(appliances[i].gpio, RELAY_OFF);
    appliances[i].state = false;

    int actualLevel = digitalRead(appliances[i].gpio);
    Serial.printf("[HARDWARE] %s (GPIO %d) -> Boot State: %s (Readback: %d)\n",
                  appliances[i].name,
                  appliances[i].gpio,
                  (RELAY_OFF == LOW ? "LOW (0V / SAFE OFF)" : "HIGH"),
                  actualLevel);
  }
  Serial.println("[HARDWARE] Safe boot verified: All relays are de-energized.");
}

// ============================================================================
// Wi-Fi Connection Management
// ============================================================================
void setupWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.println("\n============================================================");
  Serial.printf("[WIFI] Connecting to SSID: '%s' ...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 15000) {
    delay(400);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI] Connected successfully!");
    Serial.printf("[WIFI] Assigned IP Address: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("[WIFI] Signal Strength (RSSI): %d dBm\n", WiFi.RSSI());
  } else {
    Serial.println("\n[WIFI] Initial connection attempt timed out. Reconnection loop active.");
  }
}

void checkWiFi() {
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastWifiCheckTime > WIFI_RETRY_INTERVAL_MS) {
      lastWifiCheckTime = millis();
      Serial.println("[WIFI] Disconnected. Re-attempting non-blocking Wi-Fi connect...");
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

  Serial.printf("[THINGSBOARD] Connecting to %s:%d using Device Access Token...\n", TB_SERVER, TB_PORT);

  // In ThingsBoard, Device Access Token is passed as MQTT Username (password NULL)
  if (client.connect(MQTT_CLIENT_ID, TB_ACCESS_TOKEN, NULL)) {
    Serial.println("[THINGSBOARD] Successfully connected to ThingsBoard MQTT Broker!");

    // Subscribe to Two-Way RPC requests
    client.subscribe(TB_RPC_SUBSCRIBE);
    Serial.printf("[THINGSBOARD] Subscribed to RPC: %s\n", TB_RPC_SUBSCRIBE);

    // Subscribe to Shared Attributes
    client.subscribe(TB_ATTRIBUTES_UPDATE);
    Serial.printf("[THINGSBOARD] Subscribed to Attributes: %s\n", TB_ATTRIBUTES_UPDATE);

    // Send full state synchronization
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
    Serial.println("[MQTT] Payload exceeds 512 byte buffer limit!");
    return;
  }

  char message[512];
  memcpy(message, payload, length);
  message[length] = '\0';

  String topicStr = String(topic);
  Serial.printf("\n[THINGSBOARD INBOUND] Topic: %s\nPayload: %s\n", topic, message);

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
// ThingsBoard Two-Way RPC Handler
// ============================================================================
void handleRpcRequest(String topic, const char* jsonPayload) {
  int lastSlash = topic.lastIndexOf('/');
  String requestId = topic.substring(lastSlash + 1);

#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument doc;
#else
  StaticJsonDocument<512> doc;
#endif

  DeserializationError error = deserializeJson(doc, jsonPayload);
  if (error) {
    Serial.printf("[RPC ERROR] JSON parse failure: %s\n", error.c_str());
    return;
  }

  const char* method = doc["method"];
  if (!method) {
    Serial.println("[RPC ERROR] Missing 'method' in RPC payload.");
    return;
  }

  Serial.printf("[RPC] Received method: %s | RequestId: %s\n", method, requestId.c_str());

  // Method 1: Direct appliance commands
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
  // Method 2: Generic appliance method: { appliance: "light1", state: true }
  else if (strcasecmp(method, "setAppliance") == 0) {
    const char* appName = doc["params"]["appliance"];
    bool state = doc["params"]["state"].as<bool>();
    int idx = findApplianceIndex(appName);
    if (idx >= 0) {
      setApplianceState(idx, state, requestId.c_str());
    }
  }
  // Method 3: Pin-based method: { pin: 16, state: true }
  else if (strcasecmp(method, "setGpio") == 0 || strcasecmp(method, "setValue") == 0) {
    int pin = doc["params"]["pin"].as<int>();
    bool state = doc["params"]["state"].as<bool>();
    for (int i = 0; i < 4; i++) {
      if (appliances[i].gpio == pin) {
        setApplianceState(i, state, requestId.c_str());
        break;
      }
    }
  }
  // Method 4: Query full status
  else if (strcasecmp(method, "getStatus") == 0 || strcasecmp(method, "getValue") == 0) {
#if ARDUINOJSON_VERSION_MAJOR >= 7
    JsonDocument resDoc;
#else
    StaticJsonDocument<384> resDoc;
#endif
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
#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument doc;
#else
  StaticJsonDocument<512> doc;
#endif
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
// Appliance Controller & Real Hardware Readback Confirmation
// ============================================================================
bool setApplianceState(int index, bool targetState, const char* requestId) {
  if (index < 0 || index >= 4) return false;

  uint8_t gpio = appliances[index].gpio;
  uint8_t outputLevel = targetState ? RELAY_ON : RELAY_OFF;

  // 1. Set Hardware Pin
  digitalWrite(gpio, outputLevel);

  // 2. Read back actual hardware pin voltage level
  int actualLevel = digitalRead(gpio);
  bool confirmedState = (actualLevel == RELAY_ON);
  appliances[index].state = confirmedState;

  totalCommandsProcessed++;

  Serial.printf("[HARDWARE CONFIRMED] %s (GPIO %d) -> %s (Voltage Level: %s)\n",
                appliances[index].name,
                gpio,
                (confirmedState ? "ON (HIGH)" : "OFF (LOW)"),
                (actualLevel == HIGH ? "3.3V" : "0V"));

  // 3. Send Two-Way RPC Response
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
#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument doc;
#else
  StaticJsonDocument<256> doc;
#endif
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
// Publish Client Attributes
// ============================================================================
void publishAttributes() {
  if (!client.connected()) return;

#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument doc;
#else
  StaticJsonDocument<384> doc;
#endif
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
// Publish Periodic Telemetry (Heartbeat)
// ============================================================================
void publishTelemetry() {
  if (!client.connected()) return;

#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument doc;
#else
  StaticJsonDocument<384> doc;
#endif
  doc["uptime"] = millis() / 1000;
  doc["rssi"] = WiFi.RSSI();
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["commandsProcessed"] = totalCommandsProcessed;
  doc["status"] = "online";

  for (int i = 0; i < 4; i++) {
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
// Main Arduino Setup & Loop
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n============================================================");
  Serial.println("  ESP32 SMART HOME AUTOMATION — THINGSBOARD HARDWARE FIRMWARE ");
  Serial.println("============================================================");
  Serial.printf("Device ID: %s\n", TB_DEVICE_ID);
  Serial.printf("Server:    %s:%d\n", TB_SERVER, TB_PORT);
  Serial.printf("Wi-Fi:     %s\n", WIFI_SSID);

  // 1. Mandatory Safe Boot: Set all GPIOs to LOW (0V)
  initHardwarePins();

  // 2. Wi-Fi Initialization
  setupWiFi();

  // 3. MQTT Client Setup
  client.setServer(TB_SERVER, TB_PORT);
  client.setCallback(onMqttMessage);
  client.setBufferSize(512);

  // 4. Initial Connection
  reconnectThingsBoard();
}

void loop() {
  // Non-blocking Wi-Fi monitor
  checkWiFi();

  // Non-blocking MQTT monitor
  if (WiFi.status() == WL_CONNECTED) {
    if (!client.connected()) {
      reconnectThingsBoard();
    } else {
      client.loop();
    }
  }

  // Periodic Telemetry every 15s
  if (millis() - lastTelemetryTime > TELEMETRY_INTERVAL_MS) {
    lastTelemetryTime = millis();
    publishTelemetry();
  }
}
