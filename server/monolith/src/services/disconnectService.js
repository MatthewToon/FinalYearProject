/*
 * Disconnect service.
 *
 * This service handles the application-level effects of a socket disconnect.
 * It is responsible for:
 * locating any active game session associated with the disconnected socket
 * marking the relevant player as disconnected
 * preserving the authoritative session state
 * returning enough information for handlers to emit PLAYER_LEFT and STATE_SYNC
 *
 * It does not emit socket events directly.
 */

const sessionStore = require("../state/sessionStore");

async function handleDisconnect(socketId) {
  const session = sessionStore.findSessionBySocketId(socketId);

  if (!session) {
    return {
      ok: true,
      session: null,
      disconnectedPlayerId: null
    };
  }

  let disconnectedPlayerId = null;

  if (session.players.white && session.players.white.socketId === socketId) {
    session.players.white.connected = false;
    disconnectedPlayerId = session.players.white.playerId;
  }

  if (session.players.black && session.players.black.socketId === socketId) {
    session.players.black.connected = false;
    disconnectedPlayerId = session.players.black.playerId;
  }

  await sessionStore.saveSession(session);

  return {
    ok: true,
    session,
    disconnectedPlayerId
  };
}

module.exports = {
  handleDisconnect
};