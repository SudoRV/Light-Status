#include <ESP8266WiFi.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <ESP8266HTTPClient.h>

#define LIGHT_STATUS 5

// Wi-Fi credentials
const char* ssid = "Rahul Network";
const char* password = "rahul@1992#";

// Local server IP and port to get access token
const int serverPort = 8000;
String baseTokenURL = "https://light-status.onrender.com/get/access-token";
String accessTokenURL;

int prevLightStatus = -1;
unsigned long prevWakeup = 0;

// FCM settings
const char* projectID = "light-status-41588";
const char* deviceToken = "dn8VlsOUTvmZdIUSZfEjNj:APA91bG3TPUcy-5_5thI47rpVX9YGHPiJ2bD6-6SorPGaPx-Sfvs2ZZ9Ijy4mC1K5oxFVjdYAy_CWyH4tEh_hzYQyU_j5CV4yO_sPrkwIWE7e6_kAxkzEIs";
//"czdaUmnSRAKDPj3Kz2IIxD:APA91bFJOzmf5lHwhE3Avicx23bpb95Bsk55vEPWfwR0ewJAdCf-zwpM-FTJ1Ei7MkyENBLwm791BzuNDlrMaDURF8stvl6NTRe9B2Ocm4H2VbcKKjHOfU0";

// FCM API URL
String fcmURL = "https://fcm.googleapis.com/v1/projects/" + String(projectID) + "/messages:send";

void setup() {
  Serial.begin(9600);
  setupWifi();
  pinMode(LIGHT_STATUS, INPUT);
}

void loop() {
  readLightStatus();
  wakeupTokenServer();
  delay(500);
}

void setupWifi() {
  WiFi.begin(ssid, password);
  Serial.print("\nConnecting to Wi-Fi...");
  // Connect to Wi-Fi
  while (WiFi.status() != WL_CONNECTED) {
    delay(1000);
    Serial.print(".");
  }
  Serial.print("\nConnected to Wi-Fi IP: ");
  Serial.println(WiFi.localIP());
}

void wakeupTokenServer() {
  unsigned long now = millis();
  // Wake up only if 30 minutes have passed (30 * 60 * 1000 ms)
  if (now - prevWakeup < 15UL * 60 * 1000) {
    return;  // Exit early if it's not time yet
  }
  Serial.println("\nWaking up Token Server");

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.begin(client, "https://light-status.onrender.com/wakeup");

  int httpCode = http.GET();  // Send HTTP GET request

  if (httpCode == HTTP_CODE_OK) {
    String response = http.getString();
    Serial.println(response);
    prevWakeup = now;
  } else {
    Serial.print("Failed to wakeup");
  }
  http.end();  // Close connection
}

void readLightStatus() {
  int light_status = digitalRead(LIGHT_STATUS);

  if (light_status != prevLightStatus) {
push:
    int httpCode = pushMsg(light_status);
    if (httpCode == 200) {
      prevLightStatus = light_status;
    } else {
      delay(1000);
      goto push;
    }
  }
}

int pushMsg(int status) {
  Serial.println("Preparing to push data...");

  // Initialize HTTP Client
  HTTPClient http;
  WiFiClientSecure client;
  client.setInsecure();  // Skip SSL certificate verification for testing

  String serverURL = "https://light-status.onrender.com/push";  // Replace with actual server URL

  http.begin(client, serverURL);
  http.addHeader("Content-Type", "application/json; charset=UTF-8");

  // JSON payload
  StaticJsonDocument<256> payload;
  payload["light_status"] = status;
  payload["feed_time"] = millis();

  String jsonPayload;
  serializeJson(payload, jsonPayload);

  Serial.println("Payload:");
  Serial.println(jsonPayload);

  // Send the POST request
  int httpCode = http.POST(jsonPayload);
  String response = http.getString();

  Serial.print("Server Response (Code ");
  Serial.print(httpCode);
  Serial.println("):");
  Serial.println(response);

  http.end();
  return httpCode;
}
