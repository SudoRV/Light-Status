const express = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const env = process.env;

const app = express();
app.use(express.json());

const fcm_url = `https://fcm.googleapis.com/v1/projects/${env.PROJECT_ID}/messages:send`;
const TOKEN_FILE = path.join(__dirname, 'access_token.json');
let isTokenRefreshing = false;

// Track server start time
const serverStartTime = Date.now();
// Light status tracking
let lightStatus = {
    status: "Off", 
    time: Date.now()
};

// Service account
const serviceAccount = {
    "private_key": env.PRIVATE_KEY,
    "client_email": env.CLIENT_EMAIL
};



// Wake up token server
app.get("/wakeup", (req, res) => {
    console.log("Waking up");
    res.status(200).send("Haaahhh... I Woke Up");
});


//push notification to device directly server to server
app.post("/push", async (req, res) => {    
    const { light_status, feed_time } = req.body;
    const lightStatus = light_status ? "Light Aagyi Bro" : "Light Chale Gayi Bro";
    const access_token_data = await refreshToken();
  
    const payload = { 
        message:{
            token: env.DEVICE_TOKEN,
            notification: {
                title: "ESP8266",
                body: lightStatus,              
            },
            data:{
                'light_status': lightStatus,
                'feed_time': feed_time.toString(),
                'server_status': 'Awake',
                'server_startime': serverStartTime.toString()                 
            }
        }
    }  
    
    const { http_code, response } = await pushMsg(fcm_url, access_token_data.access_token, payload);
    res.status(http_code).json(response);
})


// Get current light and system status
app.get("/system-status", (req, res) => { 
    const data = {
        light_status: lightStatus.status,
        feed_time: lightStatus.time,
        server_status:"Awake",
        server_startime: serverStartTime
    }   
    console.log(data)
    res.status(200).json(data);                       
});

// Start the server
const port = 8000;
app.listen(port, () => {
    console.log(`API running at http://localhost:${port}`);
});


// ================= Functions ===================

async function dumpToken(tokenData) {
    tokenData.expires_in = Date.now() + tokenData.expires_in * 1000;
    try {
        fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 4));
        console.log('Access token saved successfully.');
    } catch (error) {
        console.error('Error writing token to file:', error);
    }
}

async function loadToken() {
    try {
        if (fs.existsSync(TOKEN_FILE)) {
            const data = fs.readFileSync(TOKEN_FILE, 'utf-8');
            return JSON.parse(data);
        } else {
            console.warn('Token file not found.');
            return null;
        }
    } catch (error) {
        console.error('Error reading token from file:', error);
        return null;
    }
}

// Generate JWT
function generateJWT() {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iss: serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600 // 1-hour expiration
    };

    return jwt.sign(payload, serviceAccount.private_key, { algorithm: 'RS256' });
}

// Get Access Token
async function getAccessToken(token) {
    const jwtToken = token;

    try {
        const response = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwtToken
        }).toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        return response.data;
    } catch (error) {
        console.error('Failed to get access token:', error.response);
        throw error;
    }
}

// Refresh token if expired
async function refreshToken() {
    if (!isTokenRefreshing) {
        const data = await loadToken();
        if (data && Date.now() > data.expires_in - 10000) {
            console.log("Refreshing token");
            const jwtToken = await generateJWT();
            const access_token_data = await getAccessToken(jwtToken);

            dumpToken(access_token_data);
            return access_token_data;
        } else if (data == null) {
            const jwtToken = await generateJWT();
            const access_token_data = await getAccessToken(jwtToken);

            dumpToken(access_token_data);
            console.log("File not found, token generated");
            return access_token_data;
        } else {
            console.log("Already have token");
            return await loadToken();
        }
    }
}




// Utility function to format duration
function formatDuration(seconds) {
    if (seconds < 60) {
        return `${seconds}s`;
    } else if (seconds < 3600) { // Less than 1 hour
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    } else if (seconds < 86400) { // Less than 1 day
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    } else { // More than 1 day
        const days = Math.floor(seconds / 86400);
        const hrs = Math.floor((seconds % 86400) / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return `${String(days).padStart(3, '0')}:${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
}



// Send Push Notification
async function pushMsg(url, accessToken, payload) {
    console.log("pushing notification");
    console.log(payload);
    try {
        const response = await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('Notification sent successfully:', response.data);
        return { http_code:200, response: response.data};
    } catch (error) {
        console.error('FCM Error:', error.response.data);
        return { http_code:200, response: error.response.data};
    }
}
