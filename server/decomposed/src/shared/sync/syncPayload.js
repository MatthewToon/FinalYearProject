/*
 * Builds protocol-safe sync payloads for gateway broadcasts.
 */

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
