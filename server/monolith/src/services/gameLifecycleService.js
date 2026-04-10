/*
 * Game lifecycle service.
 *
 * This service contains the application logic for creating and managing game
 * sessions. At this stage, it supports:
 * GAME_CREATE
 * GAME_JOIN
 * GAME_RESUME
 * REMATCH_REQUEST
 * RESIGN
 * internal transition from WAITING_FOR_PLAYERS to IN_PROGRESS
 *
 * It does not emit socket events directly. Instead, it returns structured
 * results to the handler layer, which is responsible for protocol responses.
 */

const sessionFactory = require("../state/sessionFactory");
const sessionStore = require("../state/sessionStore");
const stateMachine = require("../state/stateMachine");
const { SESSION_STATES, START_FEN } = require("../config/constants");
const { pool } = require("../persistence/db");

async function createGame({ clientId, playerId, socketId, roomName, roomPassword }) {
  if (!roomName || !roomPassword) {
    return {
      ok: false,
      error: {
        code: "INVALID_ROOM_DETAILS",
        message: "Room name and password are required"
      }
    };
  }

  const existingSession = await sessionStore.getSessionByRoomName(roomName);

  if (existingSession) {
    return {
      ok: false,
      error: {
        code: "ROOM_ALREADY_EXISTS",
        message: "A room with that name already exists"
      }
    };
  }

  const session = sessionFactory.createSession({
    creatorClientId: clientId,
    creatorPlayerId: playerId,
    creatorSocketId: socketId
  });

  session.roomName = roomName;
  session.roomPassword = roomPassword;

  await sessionStore.createSession(session);

  return {
    ok: true,
    session
  };
}

async function joinGame({ roomName, roomPassword, clientId, playerId, socketId }) {
  const session = await sessionStore.getSessionByRoomName(roomName);

  if (!session) {
    return {
      ok: false,
      error: {
        code: "ROOM_NOT_FOUND",
        message: "The requested room does not exist"
      }
    };
  }

  if (session.roomPassword !== roomPassword) {
    return {
      ok: false,
      error: {
        code: "INVALID_ROOM_PASSWORD",
        message: "The room password is incorrect"
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

  await sessionStore.saveSession(session);

  let gameStarted = false;

  if (stateMachine.isReadyToStart(session)) {
    session.state = SESSION_STATES.IN_PROGRESS;
    session.turnColour = "white";
    await sessionStore.saveSession(session);
    gameStarted = true;
  }

  return {
    ok: true,
    session,
    assignedColour: "black",
    gameStarted
  };
}

async function resumeGame({ gameId, clientId, socketId }) {
  const session = await sessionStore.getSession(gameId);

  if (!session) {
    return {
      ok: false,
      error: {
        code: "GAME_NOT_FOUND",
        message: "The requested game does not exist"
      }
    };
  }

  let player = null;
  let colour = null;

  if (session.players.white?.clientId === clientId) {
    player = session.players.white;
    colour = "white";
  }

  if (session.players.black?.clientId === clientId) {
    player = session.players.black;
    colour = "black";
  }

  if (!player) {
    return {
      ok: false,
      error: {
        code: "PLAYER_NOT_IN_GAME",
        message: "Client is not part of this game"
      }
    };
  }

  player.socketId = socketId;
  player.connected = true;

  await sessionStore.saveSession(session);

  return {
    ok: true,
    session,
    assignedColour: colour,
    reconnectedPlayerId: player.playerId
  };
}

async function requestRematch({ gameId, playerId }) {
  const session = await sessionStore.getSession(gameId);

  if (!session) {
    return {
      ok: false,
      error: {
        code: "GAME_NOT_FOUND",
        message: "The requested game does not exist"
      }
    };
  }

  if (session.state !== SESSION_STATES.FINISHED) {
    return {
      ok: false,
      error: {
        code: "INVALID_GAME_STATE",
        message: "Rematch can only be requested after the game has finished"
      }
    };
  }

  let requestingColour = null;

  if (session.players.white?.playerId === playerId) {
    requestingColour = "white";
  }

  if (session.players.black?.playerId === playerId) {
    requestingColour = "black";
  }

  if (!requestingColour) {
    return {
      ok: false,
      error: {
        code: "PLAYER_NOT_IN_GAME",
        message: "The requesting player is not part of this game"
      }
    };
  }

  session.rematch[requestingColour] = true;

  const bothPlayersAccepted = session.rematch.white && session.rematch.black;

  if (!bothPlayersAccepted) {
    await sessionStore.saveSession(session);

    return {
      ok: true,
      session,
      rematchStarted: false
    };
  }

  session.state = SESSION_STATES.IN_PROGRESS;
  session.revision = 0;
  session.fen = START_FEN;
  session.turnColour = "white";
  session.result = null;
  session.moveHistory = [];
  session.rematch = {
    white: false,
    black: false
  };

  await pool.query(
    `
      DELETE FROM moves
      WHERE game_id = $1
    `,
    [session.gameId]
  );

  await sessionStore.saveSession(session);

  return {
    ok: true,
    session,
    rematchStarted: true
  };
}

async function resignGame({ gameId, playerId }) {
  const session = await sessionStore.getSession(gameId);

  if (!session) {
    return {
      ok: false,
      error: {
        code: "GAME_NOT_FOUND",
        message: "The requested game does not exist"
      }
    };
  }

  if (session.state !== SESSION_STATES.IN_PROGRESS) {
    return {
      ok: false,
      error: {
        code: "INVALID_GAME_STATE",
        message: "Resignation is only allowed while the game is in progress"
      }
    };
  }

  let resigningColour = null;

  if (session.players.white?.playerId === playerId) {
    resigningColour = "white";
  }

  if (session.players.black?.playerId === playerId) {
    resigningColour = "black";
  }

  if (!resigningColour) {
    return {
      ok: false,
      error: {
        code: "PLAYER_NOT_IN_GAME",
        message: "The resigning player is not part of this game"
      }
    };
  }

  session.state = SESSION_STATES.FINISHED;
  session.turnColour = null;
  session.result =
    resigningColour === "white"
      ? "BLACK_WIN_RESIGNATION"
      : "WHITE_WIN_RESIGNATION";

  await sessionStore.saveSession(session);

  return {
    ok: true,
    session,
    resigningColour
  };
}

module.exports = {
  createGame,
  joinGame,
  resumeGame,
  requestRematch,
  resignGame
};