package com.example.lightstatus;

import android.annotation.SuppressLint;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.AsyncTask;
import android.os.Bundle;
import android.os.Handler;
import android.util.Log;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;

public class MainActivity extends AppCompatActivity {

    private TextView tokenTextView;
    private Button generateButton, copyButton;

    public TextView light_status;
    public TextView light_uptime_label;
    public TextView light_uptime;
    public TextView server_status;
    public TextView server_uptime_label;
    public TextView server_uptime;
    long currentTime;

    //loop runners for light uptime update
    private Handler lightUptimeHandler;
    private Runnable lightUptimeRunnable;
    //loop runners for server uptime update
    private Handler serverUptimeHandler;
    private Runnable serverUptimeRunnable;

    // SharedPreferences to store the generated token locally
    private SharedPreferences sharedPreferences;
    private static final String PREF_NAME = "FCM_PREF";
    private static final String TOKEN_KEY = "fcm_token";

    //broadcast listener for light status
    private BroadcastReceiver lightStatusReceiver;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        tokenTextView = findViewById(R.id.tokenTextView);
        generateButton = findViewById(R.id.generateButton);
        copyButton = findViewById(R.id.copyButton);

        light_status = findViewById(R.id.light_status);
        light_uptime_label  = findViewById(R.id.light_uptime_label);
        light_uptime = findViewById(R.id.light_uptime);

        server_status = findViewById(R.id.server_status);
        server_uptime_label = findViewById(R.id.server_uptime_label);
        server_uptime = findViewById(R.id.server_uptime);

        //receive the notification
        lightStatusReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if ("com.example.lightstatus.NEW_NOTIFICATION".equals(intent.getAction())) {
                    String notification = intent.getStringExtra("notification");
                    Log.d("fcm-msg", notification);
                    JSONObject notificationObj;
                    try {
                        notificationObj = new JSONObject(notification);
                        JSONObject data = new JSONObject(String.valueOf(new JSONObject(notificationObj.getString("data"))));

                        updateStatus(light_status, light_uptime, light_uptime_label, data.getString("light_status"), Long.parseLong(data.getString("feed_time")));
                        updateStatus(server_status, server_uptime, server_uptime_label, "Awake", Long.parseLong(data.getString("server_startime")));
                    } catch (JSONException e) {
                        throw new RuntimeException(e);
                    }
                }
            }
        };
        
        // Register Receiver
        IntentFilter filter = new IntentFilter("com.example.lightstatus.NEW_NOTIFICATION");
        registerReceiver(lightStatusReceiver, filter);

        sharedPreferences = getSharedPreferences(PREF_NAME, MODE_PRIVATE);
        // Check if token already exists
        String savedToken = sharedPreferences.getString(TOKEN_KEY, null);
        if (savedToken != null) {
            tokenTextView.setText(savedToken); // Display the saved token
        } else {
            tokenTextView.setText("Click 'Generate Token' to get FCM Token.");
        }

        // Generate Token on Button Click
        generateButton.setOnClickListener(v -> {
            if (savedToken == null) {
                FirebaseMessaging.getInstance().getToken()
                        .addOnCompleteListener(task -> {
                            if (task.isSuccessful()) {
                                String token = task.getResult();
                                tokenTextView.setText(token);
                                saveToken(token);
                                Log.d("FCM Token", token);
                                Toast.makeText(MainActivity.this, "Token Generated!", Toast.LENGTH_SHORT).show();
                            } else {
                                tokenTextView.setText("Failed to generate token");
                                Log.w("FCM Token", "Fetching FCM registration token failed", task.getException());
                            }
                        });
            } else {
                Toast.makeText(MainActivity.this, "Token already generated!", Toast.LENGTH_SHORT).show();
            }
        });

        // Copy Token to Clipboard
        copyButton.setOnClickListener(v -> {
            String token = tokenTextView.getText().toString();
            if (!token.isEmpty() && !token.equals("Click 'Generate Token' to get FCM Token.")) {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                ClipData clip = ClipData.newPlainText("FCM Token", token);
                clipboard.setPrimaryClip(clip);
                Toast.makeText(MainActivity.this, "Token copied to clipboard!", Toast.LENGTH_SHORT).show();
            } else {
                Toast.makeText(MainActivity.this, "No token to copy!", Toast.LENGTH_SHORT).show();
            }
        });
    }

    //fetch set light and server status
    @Override
    protected void onResume() {
        super.onResume();
        fetchSetSystemStatus(light_status, light_uptime, light_uptime_label, server_status, server_uptime, server_uptime_label);
    }

    // remove the runnable
    @Override
    protected void onPause() {
        super.onPause();
        // Stop light uptime updates
        if (lightUptimeHandler != null && lightUptimeRunnable != null) {
            lightUptimeHandler.removeCallbacks(lightUptimeRunnable);
        }
        // Stop server uptime updates
        if (serverUptimeHandler != null && serverUptimeRunnable != null) {
            serverUptimeHandler.removeCallbacks(serverUptimeRunnable);
        }
    }

    // Save token locally in SharedPreferences
    private void saveToken(String token) {
        SharedPreferences.Editor editor = sharedPreferences.edit();
        editor.putString(TOKEN_KEY, token);
        editor.apply();
    }

    @SuppressLint("StaticFieldLeak")
    public void fetchSetSystemStatus(TextView lightStatusView, TextView lightUptimeView, TextView lightUptimeLabel,
                                     TextView serverStatusView, TextView serverUptimeView, TextView serverUptimeLabel) {

        currentTime = System.currentTimeMillis(); // Initialized once

        new AsyncTask<Void, Void, JSONObject>() {
            @Override
            protected JSONObject doInBackground(Void... voids) {
                HttpURLConnection connection = null;

                try {
                    URL url = new URL("https://light-status.onrender.com/system-status");
                    connection = (HttpURLConnection) url.openConnection();
                    connection.setRequestMethod("GET");
                    connection.setConnectTimeout(5000);
                    connection.setReadTimeout(5000);

                    int responseCode = connection.getResponseCode();
                    if (responseCode == HttpURLConnection.HTTP_OK) {
                        BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream()));
                        StringBuilder response = new StringBuilder();
                        String line;
                        while ((line = reader.readLine()) != null) {
                            response.append(line);
                        }
                        reader.close();
                        return new JSONObject(response.toString());
                    } else {
                        Log.e("fetch-error", "Server returned: " + responseCode);
                    }
                } catch (SocketTimeoutException e) {
                    handleNetworkError("Connection timed out: " + e.getMessage(), serverStatusView, serverUptimeLabel, serverUptimeView);
                } catch (IOException e) {
                    handleNetworkError("Network error: " + e.getMessage(), serverStatusView, serverUptimeLabel, serverUptimeView);
                } catch (Exception e) {
                    Log.e("fetch-error", "Unexpected error: " + e.getMessage());
                } finally {
                    if (connection != null) {
                        connection.disconnect();
                    }
                }
                return null;
            }

            @Override
            protected void onPostExecute(JSONObject result) {
                if (result != null) {
                    try {
                        String lightStatus = result.getString("light_status");
                        long lightFeedTime = result.getLong("feed_time");

                        String serverStatus = result.getString("server_status");
                        long serverStartTime = result.getLong("server_startime");

                        updateStatus(lightStatusView, lightUptimeView, lightUptimeLabel, lightStatus, lightFeedTime);
                        updateStatus(serverStatusView, serverUptimeView, serverUptimeLabel, serverStatus, serverStartTime);

                    } catch (JSONException e) {
                        Log.e("fetch-error", "JSON Parsing Error: " + e.getMessage());
                        showError(lightStatusView, lightUptimeView, serverStatusView, serverUptimeView);
                    }
                } else {
                    Log.e("fetch-error", "Failed to fetch system status.");
                    handleNetworkError("Server Offline", serverStatusView, serverUptimeLabel, serverUptimeView);
                }
            }
        }.execute();
    }

    private void handleNetworkError(String errorMsg, TextView statusView, TextView uptimeLabel, TextView uptimeView) {
        runOnUiThread(() -> {
            Log.e("Network Error", errorMsg);
            statusView.setText("Offline");
            statusView.setTextColor(getResources().getColor(R.color.off_status));
            uptimeLabel.setText("Downtime : ");
            uptimeView.setTextColor(getResources().getColor(R.color.downtime));
            updateUptimePeriodically(currentTime, uptimeView);
        });
    }

    private void updateStatus(TextView statusView, TextView uptimeView, TextView uptimeLabel, String status, long startTime) {
        statusView.setText(status);
        statusView.setTextColor(getResources().getColor(R.color.on_status));
        uptimeLabel.setText(status.equals("On") || status.equals("Awake") ? "Uptime : " : "Downtime : ");
        uptimeView.setTextColor(getResources().getColor(R.color.uptime));

        long elapsedSeconds = (currentTime - startTime) / 1000;
        uptimeView.setText(formatDuration(elapsedSeconds));
        updateUptimePeriodically(startTime, uptimeView);
    }

    private void showError(TextView lightStatusView, TextView lightUptimeView, TextView serverStatusView, TextView serverUptimeView) {
        lightStatusView.setText("Error");
        lightUptimeView.setText("Error");
        serverStatusView.setText("Error");
        serverUptimeView.setText("Error");
    }

    //update time periodically
    // Generalized function to update uptime
    private void updateUptimePeriodically(long startTime, TextView uptimeView) {
        Handler handler;
        Runnable runnable;

        // Determine the type based on the uptimeView ID
        String viewIdName = uptimeView.getResources().getResourceEntryName(uptimeView.getId());

        boolean isLight = viewIdName.toLowerCase().contains("light_uptime");

        // Clear existing handler if already running
        if (isLight) {
            if (lightUptimeHandler != null && lightUptimeRunnable != null) {
                lightUptimeHandler.removeCallbacks(lightUptimeRunnable);
            }
            handler = new Handler();
            lightUptimeHandler = handler;
        } else {
            if (serverUptimeHandler != null && serverUptimeRunnable != null) {
                serverUptimeHandler.removeCallbacks(serverUptimeRunnable);
            }
            handler = new Handler();
            serverUptimeHandler = handler;
        }

        long currentTime = System.currentTimeMillis();
        final long[] elapsedTime = {(currentTime - startTime) / 1000};

        runnable = new Runnable() {
            @Override
            public void run() {
                uptimeView.setText(formatDuration(elapsedTime[0]));
                elapsedTime[0]++;
                handler.postDelayed(this, 1000); // Update every second
            }
        };

        // Assign the runnable to the correct global reference
        if (isLight) {
            lightUptimeRunnable = runnable;
        } else {
            serverUptimeRunnable = runnable;
        }

        handler.post(runnable);
    }


    //format timestamp
    private String formatDuration(long seconds) {
        if (seconds < 60) {
            return seconds + "s";
        } else if (seconds < 3600) { // Less than 1 hour
            long mins = seconds / 60;
            long secs = seconds % 60;
            return String.format("%02d:%02d", mins, secs);
        } else if (seconds < 86400) { // Less than 1 day
            long hrs = seconds / 3600;
            long mins = (seconds % 3600) / 60;
            long secs = seconds % 60;
            return String.format("%02d:%02d:%02d", hrs, mins, secs);
        } else { // More than 1 day
            long days = seconds / 86400;
            long hrs = (seconds % 86400) / 3600;
            long mins = (seconds % 3600) / 60;
            long secs = seconds % 60;
            return String.format("%03d:%02d:%02d:%02d", days, hrs, mins, secs);
        }
    }

}
