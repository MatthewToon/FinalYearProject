/*
 * Session factory.
 *
 * This file creates new authoritative in-memory game session objects in a
 * valid initial state. It is responsible for ensuring that a newly created
 * game starts with the correct default values required by the SRS, including:
 * WAITING_FOR_PLAYERS state
 * revision 0
 * standard starting FEN
 * null turn colour until the second player joins
 */

const crypto = require("crypto");
const { SESSION_STATES, START_FEN } = require("../config/constants");

function createSession({ creatorClientId, creatorPlayerId, creatorSocketId }) {
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
        socketId: creatorSocketId,
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