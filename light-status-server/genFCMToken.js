const express = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const env = process.env;

const app = express();
app.use(express.json());

const TOKEN_FILE = path.join(__dirname, 'access_token.json');
let isTokenRefreshing = false;

// Track server start time
const serverStartTime = Date.now();
// Light status tracking
let lightStatus = {
    status: "Off", // Default status
    time: Date.now() // Timestamp of the last status change
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

// Get JWT access token
app.get("/get/access-token", async (req, res) => {
    //get and set light status 
    const light_status = req.query['light-status'];
    
    if(light_status == "On" || light_status == "Off"){
        lightStatus = {
            status: light_status,
            time: Date.now()
        }
    }
    
    console.log(`light status updated to : ${light_status}`)
       
    //send token
    const access_token_data = await refreshToken();
    res.status(200).json({ 'access_token': access_token_data.access_token });
});

// Set light status
app.post("/light-status", (req, res) => {
    const { light_status } = req.body;
    
    console.log(light_status,req.body)

    if (light_status === "On" || light_status === "Off") {
        lightStatus = {
            status: light_status,
            time: Date.now() // Store the time of status change
        };
        console.log(`Light status updated to: ${light_status}`);
        res.status(200).json({ message: "Light status updated successfully." });
    } else {
        res.status(400).json({ error: "Invalid light status. Use 'On' or 'Off'." });
    }
});

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
