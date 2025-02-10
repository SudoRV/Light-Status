#include <ESP8266WiFi.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <ESP8266HTTPClient.h>

#define LIGHT_STATUS 5

// Wi-Fi credentials
const char* ssid = "OPPO A3 Pro 5G";
const char* password = "rahul@1992#";

// Local server IP and port to get access token
const char* serverIP = "192.168.31.41";
const int serverPort = 8000;
const char* accessTokenURL = "https://light-status.onrender.com/get/access-token";

int prevLightStatus;
unsigned long prevWakeup = 0;

// FCM settings
const char* projectID = "light-status-41588";
const char* deviceToken = "fpjZR0QgQimKXCbyYFXZZM:APA91bGwXUJz9LP3WfxE10Aab5Wg4HnUZ5wNrw27dEsYJphVlEhpbadLdV5T9h4fXfRAdh7eomogmmYwAyT0aM2FnzojnnJ1hdKH2MrAh3EvCrRlfBCYnbY";

// FCM API URL
String fcmURL = "https://fcm.googleapis.com/v1/projects/" + String(projectID) + "/messages:send";


void setup() {
  Serial.begin(9600);
  setupWifi();
  pinMode(LIGHT_STATUS, INPUT);
  prevLightStatus = digitalRead(LIGHT_STATUS);
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

  String message = "default";
  if (light_status == 0) {
    message = "Light Aagyi Bro";
  } else {
    message = "Light Chali Gayi Bro";
  }

  if (light_status != prevLightStatus) {
    Serial.print(light_status);
    Serial.print(" : ");
    Serial.println(message);
push:
    int httpCode = pushMsg("ESP8266", message);
    if (httpCode == 200) {
      prevLightStatus = light_status;
    } else {
      goto push;
    }
  }
}

String getAccessToken() {
  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.begin(client, accessTokenURL);  // Correct API usage

  int httpCode = http.GET();  // Send HTTP GET request

  if (httpCode == HTTP_CODE_OK) {
    String response = http.getString();
    StaticJsonDocument<512> doc;
    DeserializationError error = deserializeJson(doc, response);
    if (!error) {
      return doc["access_token"].as<String>();  // Extract the access token
    } else {
      Serial.println("JSON Parsing Failed!");
    }
  } else {
    Serial.print("Failed to fetch token : ");
    Serial.println(httpCode);
  }
  http.end();  // Close connection
  return "";
}

int pushMsg(String title, String body) {

  // Fetch Access Token
  Serial.println("fetching token");
  String accessToken = getAccessToken();
  if (accessToken != "") {
    Serial.println("Access Token: " + accessToken);
  } else {
    Serial.println("Failed to get Access Token.");
    return 0;
  }

  Serial.println("pushing notification");
  HTTPClient http;
  WiFiClientSecure client;
  client.setInsecure();  // Skip SSL certificate verification for testing

  http.begin(client, fcmURL);  // Clean FCM URL
  http.addHeader("Authorization", "Bearer " + accessToken);
  http.addHeader("Content-Type", "application/json");

  // JSON payload for the new API
  StaticJsonDocument<512> doc;
  JsonObject message = doc.createNestedObject("message");
  message["token"] = deviceToken;

  JsonObject notification = message.createNestedObject("notification");
  notification["title"] = title;
  notification["body"] = body;

  String jsonPayload;
  serializeJson(doc, jsonPayload);

  int httpCode = http.POST(jsonPayload);
  String response = http.getString();

  Serial.println("FCM Response:");
  Serial.println(response);

  http.end();
  return httpCode;
}
