/*
 * Prometheus metric registry.
 *
 * This file creates the metric objects that the rest of the backend updates.
 * Prometheus later scrapes them through the /metrics HTTP endpoint.
 */

const client = require("prom-client");

const register = new client.Registry();

client.collectDefaultMetrics({
  // Prefix keeps this app's metrics easy to spot in Prometheus/Grafana.
  register,
  prefix: "chess_"
});

const socketMessagesTotal = new client.Counter({
  name: "chess_socket_messages_total",
  help: "Total number of socket messages processed by type and result",
  labelNames: ["type", "result"],
  registers: [register]
});

const socketErrorsTotal = new client.Counter({
  name: "chess_socket_errors_total",
  help: "Total number of socket-level errors by type and code",
  labelNames: ["type", "code"],
  registers: [register]
});

const operationDurationMs = new client.Histogram({
  name: "chess_operation_duration_ms",
  help: "Server-side operation duration in milliseconds",
  labelNames: ["operation"],
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2000],
  registers: [register]
});

const activeConnectionsGauge = new client.Gauge({
  name: "chess_active_connections",
  help: "Current number of active socket connections",
  registers: [register]
});

const activeSessionsGauge = new client.Gauge({
  name: "chess_active_sessions",
  help: "Current number of sessions loaded in memory",
  registers: [register]
});

module.exports = {
  client,
  register,
  socketMessagesTotal,
  socketErrorsTotal,
  operationDurationMs,
  activeConnectionsGauge,
  activeSessionsGauge
};