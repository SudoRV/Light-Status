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
const TOKEN_FILE = path.join(__dirname, './data/access_token.json');
let isTokenRefreshing = false;

// Track server start time
const serverStartTime = Date.now();
// Light status tracking
let lightStatus;

try{
    lightStatus = JSON.parse(fs.readFileSync("./data/data.json","utf-8"));
}catch(err){
    lightStatus = {
        status: 'Off',
        time: Date.now()
    }
}

//send first notification for preparation 
pushMsg(getPayload(lightStatus.status,"Server", "Light " + (lightStatus.status=="On"?"":"Nhi") + "Hai Bro"));

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

app.post("/save-fcm-token",(req, res)=>{
    const { device_token } = req.body;
    console.log(device_token);   
    env.DEVICE_TOKEN = device_token; 
    
    //save token to .env file 
    updateDeviceToken(device_token);
        
    res.status(200).json({response: "Token Saved Successfully"});
})

//push notification to device directly server to server
app.get("/push", async (req, res) => {    
    const { light_status } = req.body;      
    lightStatus = {
        status: light_status ? "Off" : "On",
        time: Date.now()   
    }    
    saveStatus(lightStatus);
    
    const payload = getPayload(light_status,"ESP8266")
    const { http_code, response } = await pushMsg(payload);
    res.status(http_code).json(response);
})


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
async function pushMsg(payload) {
    console.log("pushing notification");
   
    const access_token_data = await refreshToken();
    const accessToken = access_token_data.access_token;
    try {
        const response = await axios.post(fcm_url, payload, {
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


//save token to .env
function updateDeviceToken(newValue) {
    const envFilePath = '/data/.env';

    // Read existing .env content
    let envContent = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';

    // Use regex to find and replace DEVICE_TOKEN
    const regex = /^DEVICE_TOKEN.*=.*$/m;
    if (regex.test(envContent)) {
        // Replace existing DEVICE_TOKEN
        envContent = envContent.replace(regex, `DEVICE_TOKEN=${newValue}`);
    } else {
        // Append new DEVICE_TOKEN if not found
        envContent += `\nDEVICE_TOKEN=${newValue}\n`;
    }

    // Write updated content back to .env file
    fs.writeFileSync(envFilePath, envContent);

    console.log(`new device token updated successfully in .env file!`);
}

//save data status locally 
function saveStatus(data){
    fs.writeFileSync("./data/data.json",JSON.stringify(data,null,4));
    console.log("status saved successfully");
}

function getPayload(status, title, body){
    const message = status ? "Light Chale Gyi Bro" : "Light Aagyi Bro";
    const feedTime = lightStatus.time;    
  
    const payload = { 
        message:{
            token: env.DEVICE_TOKEN,
            notification: {
                title: title || "ESP8266",
                body: body || message,                                        
            },           
            data:{
                'light_status': lightStatus.status,
                'feed_time': feedTime.toString(),
                'server_status': 'Awake',
                'server_startime': serverStartTime.toString()                 
            }, 
            android:{
                notification: {
                    'sound': 'notification_sound.mp3'
                }
            }          
        }
    } 
    
    return payload;
}
