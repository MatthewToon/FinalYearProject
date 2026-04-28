// Session factory.
// This file creates new authoritative game session objects in a
// valid initial state. The decomposed version omits socket-specific
// fields because connection ownership remains in the gateway service.

const crypto = require("crypto");
const { SESSION_STATES, START_FEN } = require("../config/constants");

function createSession({ creatorClientId, creatorPlayerId }) {
  const gameId = crypto.randomUUID();

  return {
    gameId,
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
