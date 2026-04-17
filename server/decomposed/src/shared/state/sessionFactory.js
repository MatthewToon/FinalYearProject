/*
 * Factory for newly created persisted sessions.
 */

const crypto = require("crypto");
const { SESSION_STATES, START_FEN } = require("../config/constants");

function createSession({ creatorClientId, creatorPlayerId }) {
  return {
    gameId: crypto.randomUUID(),
    state: SESSION_STATES.WAITING_FOR_PLAYERS,
    revision: 0,
    fen: START_FEN,
    turnColour: null,
    result: null,
    players: {
      white: {
        clientId: creatorClientId,
        playerId: creatorPlayerId,
        connected: true
      },
      black: null
    },
    rematch: {
      white: false,
      black: false
    },
    moveHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

module.exports = {
  createSession
};
