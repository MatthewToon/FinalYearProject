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

function registerHelloHandlers(io, socket) {
  socket.on(MESSAGE_TYPES.HELLO, (rawMessage) => {
    const parsed = parseEnvelope(rawMessage);

    if (!parsed.ok) {
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
  });
}

module.exports = registerHelloHandlers;