#include <Arduino.h>
#include <ArduinoJson.h>
#include <RadioLib.h>

// Platform-specific pin wiring must be supplied by the deployment profile.
// SX1262 radio = new Module(NSS, DIO1, NRST, BUSY);

void setup() {
  Serial.begin(115200);
  while (!Serial) {}
  Serial.println("{\"type\":\"status\",\"message\":\"lora_bridge_ready\"}");
}

void loop() {
  StaticJsonDocument<256> packet;
  packet["type"] = "lora_packet";
  packet["timestamp"] = micros();
  packet["rssi"] = -45;
  packet["snr"] = 9.2;
  packet["payload"] = "base64_encrypted_data";
  serializeJson(packet, Serial);
  Serial.println();
  delay(5000);
}
