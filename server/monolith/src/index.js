  ///////////////
 //  Imports  //
///////////////

// Express provides the web server framework
const express = require("express");

// CORS allows the frontend (running on a different port) to access this API
const cors = require("cors");

// Loads environment variables from the .env file into process.env
// This allows configuration (ports, database URLs, etc.) without hardcoding values
require("dotenv").config();

// Node's built-in HTTP module - required so that both Express and the WebSocket server can share the same HTTP server instance
const http = require("http");

// The 'ws' server library provides a lightweight WebSocket implementation for Node.js
const WebSocket = require("ws");

// Create an Express application instance
const app = express();

// Determine which port the server should listen on
// Uses the PORT value from the environment variables if available,
// otherwise defaults to 3001
const PORT = process.env.PORT || 3001;

// Enable Cross-Origin Resource Sharing
// Required so the React client (e.g., running on localhost:5173) can communicate with this server
app.use(cors());

// Enable automatic parsing of incoming JSON request bodies
// This allows Express to read JSON data sent by clients
app.use(express.json());

  /////////////////////////////
 //  Health Check Endpoint  //
/////////////////////////////


// This simple endpoint allows us to verify that the server is running correctly.
// It will be used during infrastructure testing and monitoring.
app.get("/health", (req, res) => {
  res.json( { 
    status: "ok", 
    service: "monolith", 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development"
  });
});


  //////////////////////////////
 //  WebSocket Server Setup  //
//////////////////////////////

// Create a standard HTTP server using the Express application
// This allows both HTTP routes (Express) and WebSocket connections to run on the same port
const server = http.createServer(app);

// Create the WebSocket server and attach it to the HTTP server
// This enables real-time communication alongside the existing REST API endpoints
const wss = new WebSocket.Server({ server });

// Handle new WebSocket client connections
// This event fires whenever a client establishes a WebSocket connection with the server
wss.on("connection", (ws) => {

  console.log("WebSocket client connected");

  // Send an initial message to confirm that the connection was successful
  // Messages must be serialised to JSON before being sent
  ws.send(JSON.stringify({
    type: "server.connected",
    timestamp: new Date().toISOString()
  }));

  // Listen for incoming messages from the client
  // Messages are received as buffers and should be converted to strings
  ws.on("message", (message) => {

    const data = message.toString();
    console.log("WebSocket message received:", data);

  });

  // Handle client disconnection
  // This event fires when a client closes the connection or loses connectivity
  ws.on("close", () => {

    console.log("WebSocket client disconnected");

  });

});


// Start the server and begin listening for incoming requests
// When the server starts successfully, log a message to the console
server.listen(PORT, () => {
  console.log(`Monolith server running on port ${PORT}`);
});