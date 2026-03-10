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