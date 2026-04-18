const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const env = require("./config/env");
const { pool } = require("./persistence/db");
const registerHandlers = require("./handlers/registerHandlers");
const connectionRegistry = require("./connection/connectionRegistry");
const sessionStore = require("./state/sessionStore");
const { register } = require("./metrics/registry");
const { updateProcessMetrics } = require("./metrics/processMetrics");

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

app.get("/metrics", async (req, res) => {
  updateProcessMetrics();

  res.set("Content-Type", register.contentType);
  res.status(200).send(await register.metrics());
});

registerHandlers(io);

async function startServer() {
  try {
    console.log("[startup] Loading persisted sessions from database...");
    await sessionStore.loadSessionsFromDatabase();

    server.listen(env.port, () => {
      console.log(`Monolith server listening on port ${env.port}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
