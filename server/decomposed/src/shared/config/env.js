/*
 * Shared environment loader for the decomposed services.
 *
 * Each service gets its own port, but they all share the same database and
 * Redis configuration so local setup stays simple.
 */

require("dotenv").config();

function requireEnv(name, fallback = undefined) {
  const value = process.env[name] ?? fallback;

  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getServicePort(serviceName) {
  if (process.env.PORT) {
    return Number(process.env.PORT);
  }

  if (serviceName === "gateway") {
    return Number(process.env.GATEWAY_PORT || 3001);
  }

  if (serviceName === "session") {
    return Number(process.env.SESSION_SERVICE_PORT || 3002);
  }

  if (serviceName === "game") {
    return Number(process.env.GAME_SERVICE_PORT || 3003);
  }

  throw new Error(`Unknown service name: ${serviceName}`);
}

function loadEnv(serviceName) {
  return {
    nodeEnv: process.env.NODE_ENV || "development",
    serviceName,
    port: getServicePort(serviceName),
    databaseUrl: requireEnv("DATABASE_URL"),
    redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
    clientOrigin: process.env.CLIENT_ORIGIN || "*",
    requestTimeoutMs: Number(process.env.INTERNAL_REQUEST_TIMEOUT_MS || 5000)
  };
}

module.exports = {
  loadEnv
};
