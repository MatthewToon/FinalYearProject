/*
 * State synchronisation service.
 *
 * This file builds authoritative state snapshots for STATE_SYNC responses.
 * A STATE_SYNC message sends the current full server-side view of a game so
 * that clients can initialise or resynchronise their local state safely.
 *
 * Used immediately after GAME_CREATE.
 */

function buildStateSyncPayload(session) {
  return {
    gameId: session.gameId,
    state: session.state,
    revision: session.revision,
    fen: session.fen,
    turnColour: session.turnColour,
    result: session.result,
    players: session.players,
    moveHistory: session.moveHistory
  };
}

module.exports = {
  buildStateSyncPayload
};