#include <Arduino.h>
#include <ArduinoJson.h>

#define SERIAL_BAUD 115200
#define LORA_FREQ 915.0
#define LORA_BW   125.0
#define LORA_SF   7
#define LORA_CR   5
#define LORA_TX_POWER 20

uint32_t packetCounter = 0;

void setup() {
  Serial.begin(SERIAL_BAUD);
  while (!Serial && millis() < 3000) { delay(10); }
  Serial.println("{\"type\":\"boot\",\"nodeId\":\"esp32-lora-01\",\"ts\":\"" + String(millis()) + "\"}");
  Serial.println("{\"type\":\"lora_ready\",\"freq\":" + String(LORA_FREQ) + ",\"sf\":" + String(LORA_SF) + "}");
}

void loop() {
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line.length() > 0) { handleSerialCommand(line); }
  }

  static unsigned long lastHeartbeat = 0;
  if (millis() - lastHeartbeat > 30000) {
    lastHeartbeat = millis();
    StaticJsonDocument<128> doc;
    doc["type"] = "heartbeat";
    doc["nodeId"] = "esp32-lora-01";
    doc["seq"] = ++packetCounter;
    doc["ts"] = millis();
    serializeJson(doc, Serial);
    Serial.println();
  }
  delay(10);
}

void handleSerialCommand(String jsonLine) {
  StaticJsonDocument<256> doc;
  DeserializationError err = deserializeJson(doc, jsonLine);
  if (err) {
    StaticJsonDocument<128> errDoc;
    errDoc["type"] = "error";
    errDoc["message"] = "invalid json";
    serializeJson(errDoc, Serial);
    Serial.println();
    return;
  }
  const char* target = doc["target"] | "";
  const char* payload = doc["payload"] | "";
  StaticJsonDocument<128> ack;
  ack["type"] = "tx_ack";
  ack["target"] = target;
  ack["seq"] = ++packetCounter;
  ack["rssi"] = -42;
  ack["snr"] = 8.5;
  serializeJson(ack, Serial);
  Serial.println();
}
