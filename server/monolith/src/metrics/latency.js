/*
 * Metric update helpers.
 *
 * These wrapper functions hide the direct prom-client calls from the rest
 * of the code, so handlers/services can just say what happened.
 */

const {
  socketMessagesTotal,
  socketErrorsTotal,
  operationDurationMs
} = require("./registry");

function recordSocketMessage(type, result = "received") {
  socketMessagesTotal.inc({ type, result });
}

function recordSocketError(type, code = "UNKNOWN") {
  socketErrorsTotal.inc({ type, code });
}

function recordOperationDuration(operation, startedAtMs) {
  // Handlers usually pass the time they started work, and that is turned into a duration here.
  const durationMs = Date.now() - startedAtMs;
  operationDurationMs.observe({ operation }, durationMs);
  return durationMs;
}

module.exports = {
  recordSocketMessage,
  recordSocketError,
  recordOperationDuration
};