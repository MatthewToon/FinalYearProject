/**
 * Monolith server entry point.
 *
 * This file bootstraps the backend runtime by:
 * - loading configuration
 * - creating the Express HTTP server
 * - creating the Socket.IO server
 * - exposing health endpoints
 * - registering socket handlers
 *
 * It should remain an entry point, not a place for business logic.
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const env = require("./config/env");
const pool = require("./persistence/db");
const registerHandlers = require("./handlers/registerHandlers");
const connectionRegistry = require("./connection/connectionRegistry");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: env.clientOrigin
  }
});

app.get("/health", async (req, res) => {
  try {
    const dbResult = await pool.query("SELECT 1 AS ok");

    res.status(200).json({
      status: "ok",
      serverTimeMs: Date.now(),
      db: dbResult.rows[0].ok === 1 ? "up" : "down",
      activeConnections: connectionRegistry.getConnectionCount()
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      serverTimeMs: Date.now(),
      db: "down",
      error: error.message
    });
  }
});

registerHandlers(io);

server.listen(env.port, () => {
  console.log(`Monolith server listening on port ${env.port}`);
});