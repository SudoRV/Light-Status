fetch("http://192.168.31.41:8000/light-status", {
    method: "POST",
    headers: {
        "Content-Type": "application/json"  // Important for JSON data
    },
    body: JSON.stringify({ light_status: "On" })
})
.then(response => {
    if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);  // Handle HTTP errors
    }
    return response.json();
})
.then(data => {
    console.log(data);  // Log the response data
})
.catch(error => {
    console.error("Error:", error);  // Catch network or parsing errors
});