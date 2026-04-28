// Protocol envelope helpers.
// This file is responsible for:
// validating the general shape of incoming protocol messages
// normalising parsed message data for handler use
// building standard server responses using the shared message envelope

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseEnvelope(rawMessage) {
  if (!isObject(rawMessage)) {
    return {
      ok: false,
      error: {
        code: "INVALID_MESSAGE_FORMAT",
        message: "Message must be an object"
      }
    };
  }

  const { type, clientMsgId, clientTimeMs, payload } = rawMessage;

  if (!type || typeof type !== "string") {
    return {
      ok: false,
      error: {
        code: "INVALID_MESSAGE_FORMAT",
        message: "Message type is required"
      }
    };
  }

  return {
    ok: true,
    message: {
      type,
      clientMsgId: clientMsgId || null,
      clientTimeMs: clientTimeMs || null,
      payload: payload || {}
    }
  };
}

function createServerMessage(type, payload = {}, correlationMsgId = null) {
  return {
    type,
    serverTimeMs: Date.now(),
    correlationMsgId,
    payload
  };
}

function createErrorMessage(code, message, correlationMsgId = null) {
  return createServerMessage("ERROR", { code, message }, correlationMsgId);
}

module.exports = {
  parseEnvelope,
  createServerMessage,
  createErrorMessage
};