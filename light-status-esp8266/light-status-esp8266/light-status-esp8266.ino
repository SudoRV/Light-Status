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
const char* deviceToken = "fpjZR0QgQimKXCbyYFXZZM:APA91bGwXUJz9LP3WfxE10Aab5Wg4HnUZ5wNrw27dEsYJphVlEhpbadLdV5T9h4fXfRAdh7eomogmmYwAyT0aM2FnzojnnJ1hdKH2MrAh3EvCrRlfBCYnbY";
// "dn8VlsOUTvmZdIUSZfEjNj:APA91bG3TPUcy-5_5thI47rpVX9YGHPiJ2bD6-6SorPGaPx-Sfvs2ZZ9Ijy4mC1K5oxFVjdYAy_CWyH4tEh_hzYQyU_j5CV4yO_sPrkwIWE7e6_kAxkzEIs";

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
    accessTokenURL = baseTokenURL + "?light-status=" + (light_status ? "Off" : "On");
    Serial.println(accessTokenURL);
    int httpCode = pushMsg("ESP8266", message);
    if (httpCode == 200) {
      prevLightStatus = light_status;
    } else {
      delay(1000);
      goto push;
    }
  }
}

JsonObject getAccessToken(StaticJsonDocument<1024>& doc) {
  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.begin(client, accessTokenURL);  // Correct API usage

  int httpCode = http.GET();  // Send HTTP GET request

  if (httpCode == HTTP_CODE_OK) {
    String response = http.getString();

    DeserializationError error = deserializeJson(doc, response);
    if (!error) {
      JsonObject data = doc.as<JsonObject>();
      return data;
    } else {
      Serial.print("JSON Parsing Failed: ");
      Serial.println(error.c_str());
    }
  } else {
    Serial.print("Failed to fetch token: ");
    Serial.println(httpCode);
  }

  http.end();
  return JsonObject();
}

int pushMsg(String title, String body) {
  Serial.println("Fetching token...");

  // Fetch Access Token
  StaticJsonDocument<1024> tokenDoc;
  JsonObject tokenData = getAccessToken(tokenDoc);

  String accessToken;
  if (tokenData.containsKey("access_token")) {
    accessToken = tokenData["access_token"].as<String>();
    Serial.println("Access Token: " + accessToken);
  } else {
    Serial.println("Failed to get Access Token.");
    return 0;
  }

  Serial.println("Pushing notification...");

  // Initialize HTTP Client
  HTTPClient http;
  WiFiClientSecure client;
  client.setInsecure();  // Skip SSL certificate verification for testing

  http.begin(client, fcmURL);
  http.addHeader("Authorization", "Bearer " + accessToken);
  http.addHeader("Content-Type", "application/json; charset=UTF-8");  // Correct header

  // JSON payload for FCM
  StaticJsonDocument<512> payload;
  JsonObject message = payload.createNestedObject("message");
  message["token"] = deviceToken;

  JsonObject notification = message.createNestedObject("notification");
  notification["title"] = title;
  notification["body"] = body;

  // Move custom data here
  JsonObject data = message.createNestedObject("data");
  data["light_status"] = tokenData["light_status"].as<String>();
  data["feed_time"] = tokenData["feed_time"].as<String>();
  data["server_startime"] = tokenData["server_startime"].as<String>();

  String jsonPayload;
  serializeJson(payload, jsonPayload);

  Serial.println("Payload:");
  Serial.println(jsonPayload);

  // Send the notification
  int httpCode = http.POST(jsonPayload);
  String response = http.getString();

  Serial.print("FCM Response (Code ");
  Serial.print(httpCode);
  Serial.println("):");
  Serial.println(response);

  http.end();
  return httpCode;
}
