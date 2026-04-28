// Session state transition and validation helpers.
// This file contains small, focused rules for deciding whether a game
// session can move between states and whether a move is allowed to be
// applied in the current session state.

const { SESSION_STATES } = require("../config/constants");

function canJoinSession(session) {
  return (
    session &&
    session.state === SESSION_STATES.WAITING_FOR_PLAYERS &&
    session.players.black === null
  );
}

function isReadyToStart(session) {
  return (
    session &&
    session.state === SESSION_STATES.WAITING_FOR_PLAYERS &&
    session.players.white !== null &&
    session.players.black !== null
  );
}

function canSubmitMove(session) {
  return session && session.state === SESSION_STATES.IN_PROGRESS;
}

function getPlayerColour(session, playerId) {
  if (session.players.white && session.players.white.playerId === playerId) {
    return "white";
  }

  if (session.players.black && session.players.black.playerId === playerId) {
    return "black";
  }

  return null;
}

function isPlayersTurn(session, playerId) {
  const colour = getPlayerColour(session, playerId);

  if (!colour) {
    return false;
  }

  return session.turnColour === colour;
}

module.exports = {
  canJoinSession,
  isReadyToStart,
  canSubmitMove,
  getPlayerColour,
  isPlayersTurn
};