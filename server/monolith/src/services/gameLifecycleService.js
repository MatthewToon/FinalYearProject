/*
 * Game lifecycle service.
 *
 * This service contains the application logic for creating and managing game
 * sessions. At this stage, it supports:
 * - GAME_CREATE
 * - GAME_JOIN
 * - internal transition from WAITING_FOR_PLAYERS to IN_PROGRESS
 *
 * It does not emit socket events directly. Instead, it returns structured
 * results to the handler layer, which is responsible for protocol responses.
 */

const sessionFactory = require("../state/sessionFactory");
const sessionStore = require("../state/sessionStore");
const stateMachine = require("../state/stateMachine");
const { SESSION_STATES } = require("../config/constants");

function createGame({ clientId, playerId, socketId }) {
  const session = sessionFactory.createSession({
    creatorClientId: clientId,
    creatorPlayerId: playerId,
    creatorSocketId: socketId
  });

  sessionStore.createSession(session);

  return {
    ok: true,
    session
  };
}

function joinGame({ gameId, clientId, playerId, socketId }) {
  const session = sessionStore.getSession(gameId);

  if (!session) {
    return {
      ok: false,
      error: {
        code: "GAME_NOT_FOUND",
        message: "The requested game does not exist"
      }
    };
  }

  if (!stateMachine.canJoinSession(session)) {
    return {
      ok: false,
      error: {
        code: "GAME_FULL",
        message: "The requested game cannot accept another player"
      }
    };
  }

  session.players.black = {
    clientId,
    playerId,
    socketId,
    connected: true
  };

  sessionStore.saveSession(session);

  let gameStarted = false;

  if (stateMachine.isReadyToStart(session)) {
    session.state = SESSION_STATES.IN_PROGRESS;
    session.turnColour = "white";
    sessionStore.saveSession(session);
    gameStarted = true;
  }

  return {
    ok: true,
    session,
    assignedColour: "black",
    gameStarted
  };
}

module.exports = {
  createGame,
  joinGame
};