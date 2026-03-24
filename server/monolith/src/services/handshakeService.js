/*
 * Handshake service.
 *
 * This service contains the application logic for processing HELLO messages.
 * It updates the connection registry so the server knows that a socket has
 * completed the initial protocol handshake.
 *
 * It does not emit socket events directly; handlers do that.
 */

const connectionRegistry = require("../connection/connectionRegistry");

function handleHello(socketId, payload = {}) {
  const clientId = payload.clientId || null;
  const playerId = payload.playerId || null;

  const connection = connectionRegistry.markInitialised(socketId, {
    clientId,
    playerId
  });

  if (!connection) {
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Socket is not registered"
      }
    };
  }

  return {
    ok: true,
    connection
  };
}

module.exports = {
  handleHello
};