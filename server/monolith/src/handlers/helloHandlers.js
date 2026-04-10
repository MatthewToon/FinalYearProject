/*
 * HELLO / WELCOME protocol handler.
 *
 * This handler receives the initial HELLO message from a client, validates
 * the common message envelope, delegates handshake logic to the handshake
 * service, and emits either WELCOME or ERROR.
 *
 * It is the first protocol entry point after socket connection.
 */

const MESSAGE_TYPES = require("../protocol/messageTypes");
const ERROR_CODES = require("../protocol/errorCodes");
const {
  parseEnvelope,
  createServerMessage,
  createErrorMessage
} = require("../protocol/envelope");
const handshakeService = require("../services/handshakeService");
const {
  recordSocketMessage,
  recordSocketError,
  recordOperationDuration
} = require("../metrics/latency");

function registerHelloHandlers(io, socket) {
  socket.on(MESSAGE_TYPES.HELLO, (rawMessage) => {
    const startedAtMs = Date.now();
    recordSocketMessage(MESSAGE_TYPES.HELLO, "received");
    const parsed = parseEnvelope(rawMessage);

    if (!parsed.ok) {
      recordSocketMessage(MESSAGE_TYPES.HELLO, "invalid");
      recordSocketError(MESSAGE_TYPES.HELLO, parsed.error.code);
      recordOperationDuration("hello", startedAtMs);
      socket.emit(
        MESSAGE_TYPES.ERROR,
        createErrorMessage(
          ERROR_CODES.INVALID_MESSAGE_FORMAT,
          parsed.error.message
        )
      );
      return;
    }

    const result = handshakeService.handleHello(socket.id, parsed.message.payload);

    if (!result.ok) {
      recordSocketMessage(MESSAGE_TYPES.HELLO, "error");
      recordSocketError(MESSAGE_TYPES.HELLO, result.error.code);
      recordOperationDuration("hello", startedAtMs);
      socket.emit(
        MESSAGE_TYPES.ERROR,
        createErrorMessage(result.error.code, result.error.message)
      );
      return;
    }

    socket.emit(
      MESSAGE_TYPES.WELCOME,
      createServerMessage(
        MESSAGE_TYPES.WELCOME,
        {
          socketId: socket.id,
          clientId: result.connection.clientId,
          playerId: result.connection.playerId,
          message: "Handshake successful"
        },
        parsed.message.clientMsgId
      )
    );
    recordSocketMessage(MESSAGE_TYPES.HELLO, "accepted");
    recordOperationDuration("hello", startedAtMs);
  });
}

module.exports = registerHelloHandlers;