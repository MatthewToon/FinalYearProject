process.env.CHESS_SERVICE_NAME = "session";

const express = require("express");

const { loadEnv } = require("../shared/config/env");
const { CHANNELS } = require("../shared/redis/channels");
const { createRedisClients } = require("../shared/redis/clientFactory");
const { pool } = require("../shared/persistence/db");
const sessionFactory = require("../shared/state/sessionFactory");
const sessionRepository = require("../shared/persistence/sessionRepository");
const stateMachine = require("../shared/state/stateMachine");
const { buildStateSyncPayload } = require("../shared/sync/syncPayload");
const { createServerMessage, createErrorMessage } = require("../shared/protocol/envelope");
const MESSAGE_TYPES = require("../shared/protocol/messageTypes");
const { SESSION_STATES, START_FEN } = require("../shared/config/constants");

const env = loadEnv("session");
const app = express();

function emitError(socketId, code, message, clientMsgId) {
  return {
    actions: [
      {
        kind: "emitToSocket",
        socketId,
        messageType: MESSAGE_TYPES.ERROR,
        message: createErrorMessage(code, message, clientMsgId)
      }
    ]
  };
}

async function createGame(payload) {
  const { socketId, clientMsgId, clientId, playerId, roomName, roomPassword } = payload;

  if (!roomName || !roomPassword) {
    return emitError(socketId, "INVALID_ROOM_DETAILS", "Room name and password are required", clientMsgId);
  }

  const existingSession = await sessionRepository.getSessionByRoomName(roomName);

  if (existingSession) {
    return emitError(socketId, "ROOM_ALREADY_EXISTS", "A room with that name already exists", clientMsgId);
  }

  const session = sessionFactory.createSession({
    creatorClientId: clientId,
    creatorPlayerId: playerId
  });

  session.roomName = roomName;
  session.roomPassword = roomPassword;

  await sessionRepository.createSession(session);

  return {
    actions: [
      {
        kind: "setActiveGame",
        socketId,
        gameId: session.gameId
      },
      {
        kind: "joinGameRoom",
        socketId,
        gameId: session.gameId
      },
      {
        kind: "emitToSocket",
        socketId,
        messageType: MESSAGE_TYPES.GAME_CREATED,
        message: createServerMessage(
          MESSAGE_TYPES.GAME_CREATED,
          {
            gameId: session.gameId,
            roomName: session.roomName,
            assignedColour: "white"
          },
          clientMsgId
        )
      },
      {
        kind: "emitToSocket",
        socketId,
        messageType: MESSAGE_TYPES.STATE_SYNC,
        message: createServerMessage(
          MESSAGE_TYPES.STATE_SYNC,
          buildStateSyncPayload(session),
          clientMsgId
        )
      }
    ]
  };
}

async function joinGame(payload) {
  const { socketId, clientMsgId, clientId, playerId, roomName, roomPassword } = payload;
  const session = await sessionRepository.getSessionByRoomName(roomName);

  if (!session) {
    return emitError(socketId, "ROOM_NOT_FOUND", "The requested room does not exist", clientMsgId);
  }

  if (session.roomPassword !== roomPassword) {
    return emitError(socketId, "INVALID_ROOM_PASSWORD", "The room password is incorrect", clientMsgId);
  }

  if (!stateMachine.canJoinSession(session)) {
    return emitError(socketId, "GAME_FULL", "The requested game cannot accept another player", clientMsgId);
  }

  session.players.black = {
    clientId,
    playerId,
    connected: true
  };

  let gameStarted = false;

  if (stateMachine.isReadyToStart(session)) {
    session.state = SESSION_STATES.IN_PROGRESS;
    session.turnColour = "white";
    gameStarted = true;
  }

  await sessionRepository.saveSession(session);

  const actions = [
    {
      kind: "setActiveGame",
      socketId,
      gameId: session.gameId
    },
    {
      kind: "joinGameRoom",
      socketId,
      gameId: session.gameId
    },
    {
      kind: "emitToSocket",
      socketId,
      messageType: MESSAGE_TYPES.GAME_JOINED,
      message: createServerMessage(
        MESSAGE_TYPES.GAME_JOINED,
        {
          gameId: session.gameId,
          roomName: session.roomName,
          assignedColour: "black"
        },
        clientMsgId
      )
    }
  ];

  if (gameStarted) {
    actions.push({
      kind: "emitToGame",
      gameId: session.gameId,
      messageType: MESSAGE_TYPES.GAME_START,
      message: createServerMessage(
        MESSAGE_TYPES.GAME_START,
        {
          gameId: session.gameId,
          turnColour: session.turnColour
        },
        clientMsgId
      )
    });
  }

  actions.push({
    kind: "emitToGame",
    gameId: session.gameId,
    messageType: MESSAGE_TYPES.STATE_SYNC,
    message: createServerMessage(
      MESSAGE_TYPES.STATE_SYNC,
      buildStateSyncPayload(session),
      clientMsgId
    )
  });

  return { actions };
}

async function resumeGame(payload) {
  const { socketId, clientMsgId, clientId, gameId } = payload;
  const session = await sessionRepository.getSession(gameId);

  if (!session) {
    return emitError(socketId, "GAME_NOT_FOUND", "The requested game does not exist", clientMsgId);
  }

  let assignedColour = null;
  let reconnectedPlayerId = null;

  if (session.players.white?.clientId === clientId) {
    assignedColour = "white";
    reconnectedPlayerId = session.players.white.playerId;
    session.players.white.connected = true;
  }

  if (session.players.black?.clientId === clientId) {
    assignedColour = "black";
    reconnectedPlayerId = session.players.black.playerId;
    session.players.black.connected = true;
  }

  if (!assignedColour) {
    return emitError(socketId, "PLAYER_NOT_IN_GAME", "Client is not part of this game", clientMsgId);
  }

  await sessionRepository.saveSession(session);

  return {
    actions: [
      {
        kind: "setActiveGame",
        socketId,
        gameId: session.gameId
      },
      {
        kind: "joinGameRoom",
        socketId,
        gameId: session.gameId
      },
      {
        kind: "emitToGame",
        gameId: session.gameId,
        messageType: MESSAGE_TYPES.PLAYER_RECONNECTED,
        message: createServerMessage(
          MESSAGE_TYPES.PLAYER_RECONNECTED,
          {
            gameId: session.gameId,
            playerId: reconnectedPlayerId
          },
          clientMsgId
        )
      },
      {
        kind: "emitToSocket",
        socketId,
        messageType: MESSAGE_TYPES.GAME_RESUMED,
        message: createServerMessage(
          MESSAGE_TYPES.GAME_RESUMED,
          {
            gameId: session.gameId,
            assignedColour
          },
          clientMsgId
        )
      },
      {
        kind: "emitToSocket",
        socketId,
        messageType: MESSAGE_TYPES.STATE_SYNC,
        message: createServerMessage(
          MESSAGE_TYPES.STATE_SYNC,
          buildStateSyncPayload(session),
          clientMsgId
        )
      }
    ]
  };
}

async function requestRematch(payload) {
  const { socketId, clientMsgId, playerId, gameId } = payload;
  const session = await sessionRepository.getSession(gameId);

  if (!session) {
    return emitError(socketId, "GAME_NOT_FOUND", "The requested game does not exist", clientMsgId);
  }

  if (session.state !== SESSION_STATES.FINISHED) {
    return emitError(
      socketId,
      "INVALID_GAME_STATE",
      "Rematch can only be requested after the game has finished",
      clientMsgId
    );
  }

  let requestingColour = null;

  if (session.players.white?.playerId === playerId) {
    requestingColour = "white";
  }

  if (session.players.black?.playerId === playerId) {
    requestingColour = "black";
  }

  if (!requestingColour) {
    return emitError(socketId, "PLAYER_NOT_IN_GAME", "The requesting player is not part of this game", clientMsgId);
  }

  session.rematch[requestingColour] = true;

  if (!(session.rematch.white && session.rematch.black)) {
    await sessionRepository.saveSession(session);

    return {
      actions: [
        {
          kind: "emitToGame",
          gameId: session.gameId,
          messageType: MESSAGE_TYPES.REMATCH_STATUS,
          message: createServerMessage(
            MESSAGE_TYPES.REMATCH_STATUS,
            {
              gameId: session.gameId,
              rematch: session.rematch
            },
            clientMsgId
          )
        }
      ]
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

  await sessionRepository.saveSession(session);

  return {
    actions: [
      {
        kind: "emitToGame",
        gameId: session.gameId,
        messageType: MESSAGE_TYPES.REMATCH_START,
        message: createServerMessage(
          MESSAGE_TYPES.REMATCH_START,
          {
            gameId: session.gameId,
            roomName: session.roomName
          },
          clientMsgId
        )
      },
      {
        kind: "emitToGame",
        gameId: session.gameId,
        messageType: MESSAGE_TYPES.STATE_SYNC,
        message: createServerMessage(
          MESSAGE_TYPES.STATE_SYNC,
          buildStateSyncPayload(session),
          clientMsgId
        )
      }
    ]
  };
}

async function resignGame(payload) {
  const { socketId, clientMsgId, playerId, gameId } = payload;
  const session = await sessionRepository.getSession(gameId);

  if (!session) {
    return emitError(socketId, "GAME_NOT_FOUND", "The requested game does not exist", clientMsgId);
  }

  if (session.state !== SESSION_STATES.IN_PROGRESS) {
    return emitError(
      socketId,
      "INVALID_GAME_STATE",
      "Resignation is only allowed while the game is in progress",
      clientMsgId
    );
  }

  let resigningColour = null;

  if (session.players.white?.playerId === playerId) {
    resigningColour = "white";
  }

  if (session.players.black?.playerId === playerId) {
    resigningColour = "black";
  }

  if (!resigningColour) {
    return emitError(socketId, "PLAYER_NOT_IN_GAME", "The resigning player is not part of this game", clientMsgId);
  }

  session.state = SESSION_STATES.FINISHED;
  session.turnColour = null;
  session.result =
    resigningColour === "white"
      ? "BLACK_WIN_RESIGNATION"
      : "WHITE_WIN_RESIGNATION";

  await sessionRepository.saveSession(session);

  return {
    actions: [
      {
        kind: "emitToGame",
        gameId: session.gameId,
        messageType: MESSAGE_TYPES.GAME_CONCLUDED,
        message: createServerMessage(
          MESSAGE_TYPES.GAME_CONCLUDED,
          {
            gameId: session.gameId,
            result: session.result,
            reason: "RESIGNATION",
            winner:
              session.result === "WHITE_WIN_RESIGNATION" ? "white" : "black",
            fen: session.fen,
            revision: session.revision
          },
          clientMsgId
        )
      },
      {
        kind: "emitToGame",
        gameId: session.gameId,
        messageType: MESSAGE_TYPES.STATE_SYNC,
        message: createServerMessage(
          MESSAGE_TYPES.STATE_SYNC,
          buildStateSyncPayload(session),
          clientMsgId
        )
      }
    ]
  };
}

async function handleDisconnect(payload) {
  const { gameId, playerId } = payload;

  if (!gameId || !playerId) {
    return { actions: [] };
  }

  const session = await sessionRepository.getSession(gameId);

  if (!session) {
    return { actions: [] };
  }

  let disconnectedPlayerId = null;

  if (session.players.white?.playerId === playerId) {
    session.players.white.connected = false;
    disconnectedPlayerId = session.players.white.playerId;
  }

  if (session.players.black?.playerId === playerId) {
    session.players.black.connected = false;
    disconnectedPlayerId = session.players.black.playerId;
  }

  if (!disconnectedPlayerId) {
    return { actions: [] };
  }

  await sessionRepository.saveSession(session);

  return {
    actions: [
      {
        kind: "emitToGame",
        gameId: session.gameId,
        messageType: MESSAGE_TYPES.PLAYER_LEFT,
        message: createServerMessage(MESSAGE_TYPES.PLAYER_LEFT, {
          gameId: session.gameId,
          playerId: disconnectedPlayerId
        })
      },
      {
        kind: "emitToGame",
        gameId: session.gameId,
        messageType: MESSAGE_TYPES.STATE_SYNC,
        message: createServerMessage(
          MESSAGE_TYPES.STATE_SYNC,
          buildStateSyncPayload(session)
        )
      }
    ]
  };
}

async function handleSessionRequest(request) {
  switch (request.action) {
    case MESSAGE_TYPES.GAME_CREATE:
      return createGame(request.payload);
    case MESSAGE_TYPES.GAME_JOIN:
      return joinGame(request.payload);
    case MESSAGE_TYPES.GAME_RESUME:
      return resumeGame(request.payload);
    case MESSAGE_TYPES.REMATCH_REQUEST:
      return requestRematch(request.payload);
    case MESSAGE_TYPES.RESIGN:
      return resignGame(request.payload);
    case "DISCONNECT":
      return handleDisconnect(request.payload);
    default:
      return {
        actions: []
      };
  }
}

async function startSessionService() {
  const redisClients = await createRedisClients(env.redisUrl);

  await redisClients.subscriber.subscribe(CHANNELS.sessionRequests, async (rawMessage) => {
    try {
      const request = JSON.parse(rawMessage);
      const response = await handleSessionRequest(request);

      await redisClients.publisher.publish(
        request.replyTo,
        JSON.stringify({
          requestId: request.requestId,
          actions: response.actions || []
        })
      );
    } catch (error) {
      console.error("[session-service] Failed to handle request:", error);
    }
  });

  app.get("/health", async (req, res) => {
    try {
      const dbResult = await pool.query("SELECT 1 AS ok");
      const redisStatus = await redisClients.command.ping();

      res.status(200).json({
        status: "ok",
        service: "session",
        serverTimeMs: Date.now(),
        db: dbResult.rows[0].ok === 1 ? "up" : "down",
        redis: redisStatus === "PONG" ? "up" : "down"
      });
    } catch (error) {
      res.status(500).json({
        status: "error",
        service: "session",
        serverTimeMs: Date.now(),
        error: error.message
      });
    }
  });

  app.listen(env.port, () => {
    console.log(`Session service listening on port ${env.port}`);
  });
}

startSessionService().catch((error) => {
  console.error("[session-service] Failed to start:", error);
  process.exit(1);
});
