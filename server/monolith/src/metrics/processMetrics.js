// Process-level metric updater.
// Default Node/process metrics come from prom-client automatically, but these
// two gauges are app-specific, so they are refreshed before /metrics is served.

const connectionRegistry = require("../connection/connectionRegistry");
const sessionStore = require("../state/sessionStore");
const {
  activeConnectionsGauge,
  activeSessionsGauge
} = require("./registry");

function updateProcessMetrics() {
  // These values reflect the app's current in-memory state.
  activeConnectionsGauge.set(connectionRegistry.getConnectionCount());
  activeSessionsGauge.set(sessionStore.getSessionCount());
}

module.exports = {
  updateProcessMetrics
};