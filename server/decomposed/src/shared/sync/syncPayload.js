// Sync service.
// Builds protocol-safe game state payloads for STATE_SYNC responses.
// This keeps the handler layer simple and ensures a consistent state shape
// is sent to clients.

function buildStateSyncPayload(session) {
  return {
    gameId: session.gameId,
    roomName: session.roomName,
    state: session.state,
    revision: session.revision,
    fen: session.fen,
    turnColour: session.turnColour,
    result: session.result,
    players: session.players,
    moveHistory: session.moveHistory,
    rematch: session.rematch || {
      white: false,
      black: false
    }
  };
}

module.exports = {
  buildStateSyncPayload
};
