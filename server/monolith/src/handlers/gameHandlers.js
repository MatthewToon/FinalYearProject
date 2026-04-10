/*
 * GAME HANDLERS (Protocol Entry Layer)
 *
 * Handles all incoming game-related WebSocket messages.
 *
 * Supported message flows:
 * GAME_CREATE
 * GAME_JOIN
 * MOVE_SUBMIT
 * GAME_RESUME
 * REMATCH_REQUEST
 * RESIGN
 *
 * Responsibilities:
 * Validate incoming protocol envelope
 * Ensure HELLO handshake has completed
 * Delegate to appropriate service layer
 * Emit protocol responses (success or error)
 *
 */

const MESSAGE_TYPES = require("../protocol/messageTypes");
const ERROR_CODES = require("../protocol/errorCodes");
const {
  parseEnvelope,
  createServerMessage,
  createErrorMessage
} = require("../protocol/envelope");

const connectionRegistry = require("../connection/connectionRegistry");

const gameLifecycleService = require("../services/gameLifecycleService");
const moveService = require("../services/moveService");
const syncService = require("../services/syncService");
const broadcastService = require("../services/broadcastService");
const {
  recordSocketMessage,
  recordSocketError,
  recordOperationDuration
} = require("../metrics/latency");

function requireInitialisedConnection(socket, clientMsgId) {
  const connection = connectionRegistry.getConnection(socket.id);

  if (!connection || !connection.initialised) {
    socket.emit(
      MESSAGE_TYPES.ERROR,
      createErrorMessage(
        ERROR_CODES.UNAUTHORISED_CONNECTION,
        "HELLO must be completed before game messages",
        clientMsgId
      )
    );
    return null;
  }

  return connection;
}

function emitInternalError(socket, clientMsgId, message = "An unexpected internal error occurred") {
  socket.emit(
    MESSAGE_TYPES.ERROR,
    createErrorMessage(
      ERROR_CODES.INTERNAL_ERROR,
      message,
      clientMsgId
    )
  );
}

function finishHandlerMetrics(messageType, operationName, startedAtMs, status, errorCode = null) {
  recordSocketMessage(messageType, status);

  if (errorCode) {
    recordSocketError(messageType, errorCode);
  }

  recordOperationDuration(operationName, startedAtMs);
}

function emitProtocolError(
  socket,
  messageType,
  operationName,
  startedAtMs,
  status,
  code,
  message,
  clientMsgId
) {
  finishHandlerMetrics(messageType, operationName, startedAtMs, status, code);
  socket.emit(
    MESSAGE_TYPES.ERROR,
    createErrorMessage(code, message, clientMsgId)
  );
}

function emitMoveFailure(socket, clientMsgId, result, startedAtMs) {
  const messageType =
    result.errorType === "MOVE_REJECTED"
      ? MESSAGE_TYPES.MOVE_REJECTED
      : MESSAGE_TYPES.ERROR;

  finishHandlerMetrics(
    MESSAGE_TYPES.MOVE_SUBMIT,
    "move_submit",
    startedAtMs,
    "error",
    result.error.code
  );

  socket.emit(
    messageType,
    createServerMessage(
      messageType,
      {
        code: result.error.code,
        message: result.error.message
      },
      clientMsgId
    )
  );
}

function logHandlerEvent(handlerName, details = {}) {
  console.log(`[gameHandlers:${handlerName}]`, details);
}

function registerGameHandlers(io, socket) {
  socket.on(MESSAGE_TYPES.GAME_CREATE, async (rawMessage) => {
    const startedAtMs = Date.now();
    recordSocketMessage(MESSAGE_TYPES.GAME_CREATE, "received");
    try {
      const parsed = parseEnvelope(rawMessage);

      if (!parsed.ok) {
        recordSocketMessage(MESSAGE_TYPES.GAME_CREATE, "invalid");
        recordSocketError(MESSAGE_TYPES.GAME_CREATE, parsed.error.code);
        recordOperationDuration("game_create", startedAtMs);
        socket.emit(
          MESSAGE_TYPES.ERROR,
          createErrorMessage(
            ERROR_CODES.INVALID_MESSAGE_FORMAT,
            parsed.error.message
          )
        );
        return;
      }

      const connection = requireInitialisedConnection(
        socket,
        parsed.message.clientMsgId
      );
      if (!connection) return;

      const { roomName, roomPassword } = parsed.message.payload || {};

      if (!roomName || !roomPassword) {
        recordSocketMessage(MESSAGE_TYPES.GAME_CREATE, "invalid");
        recordSocketError(MESSAGE_TYPES.GAME_CREATE, ERROR_CODES.INVALID_MESSAGE_FORMAT);
        recordOperationDuration("game_create", startedAtMs);
        socket.emit(
          MESSAGE_TYPES.ERROR,
          createErrorMessage(
            ERROR_CODES.INVALID_MESSAGE_FORMAT,
            "GAME_CREATE requires payload.roomName and payload.roomPassword",
            parsed.message.clientMsgId
          )
        );
        return;
      }

      const result = await gameLifecycleService.createGame({
        clientId: connection.clientId,
        playerId: connection.playerId,
        socketId: socket.id,
        roomName,
        roomPassword
      });

      if (!result.ok) {
        recordSocketMessage(MESSAGE_TYPES.GAME_CREATE, "error");
        recordSocketError(MESSAGE_TYPES.GAME_CREATE, result.error.code);
        recordOperationDuration("game_create", startedAtMs);
        socket.emit(
          MESSAGE_TYPES.ERROR,
          createErrorMessage(
            result.error.code,
            result.error.message,
            parsed.message.clientMsgId
          )
        );
        return;
      }

      const session = result.session;
      connectionRegistry.setActiveGame(socket.id, session.gameId);
      const roomChannelName = broadcastService.getGameRoomName(session.gameId);

      socket.join(roomChannelName);

      broadcastService.sendToSocket(
        socket,
        MESSAGE_TYPES.GAME_CREATED,
        createServerMessage(
          MESSAGE_TYPES.GAME_CREATED,
          {
            gameId: session.gameId,
            roomName: session.roomName,
            assignedColour: "white"
          },
          parsed.message.clientMsgId
        )
      );

      broadcastService.sendToSocket(
        socket,
        MESSAGE_TYPES.STATE_SYNC,
        createServerMessage(
          MESSAGE_TYPES.STATE_SYNC,
          syncService.buildStateSyncPayload(session),
          parsed.message.clientMsgId
        )
      );
      recordSocketMessage(MESSAGE_TYPES.GAME_CREATE, "accepted");
      recordOperationDuration("game_create", startedAtMs);
    } catch (error) {
      console.error("[gameHandlers:GAME_CREATE] Unhandled exception:", error);
      recordSocketMessage(MESSAGE_TYPES.GAME_CREATE, "exception");
      recordSocketError(MESSAGE_TYPES.GAME_CREATE, ERROR_CODES.INTERNAL_ERROR);
      recordOperationDuration("game_create", startedAtMs);
      emitInternalError(socket, rawMessage?.clientMsgId);
    }
  });

  socket.on(MESSAGE_TYPES.GAME_JOIN, async (rawMessage) => {
    const startedAtMs = Date.now();
    recordSocketMessage(MESSAGE_TYPES.GAME_JOIN, "received");
    try {
      const parsed = parseEnvelope(rawMessage);

      if (!parsed.ok) {
        emitProtocolError(
          socket,
          MESSAGE_TYPES.GAME_JOIN,
          "game_join",
          startedAtMs,
          "invalid",
          parsed.error.code,
          parsed.error.message
        );
        return;
      }

      const connection = requireInitialisedConnection(
        socket,
        parsed.message.clientMsgId
      );
      if (!connection) return;

      const { roomName, roomPassword } = parsed.message.payload || {};

      if (!roomName || !roomPassword) {
        emitProtocolError(
          socket,
          MESSAGE_TYPES.GAME_JOIN,
          "game_join",
          startedAtMs,
          "invalid",
          ERROR_CODES.INVALID_MESSAGE_FORMAT,
          "GAME_JOIN requires payload.roomName and payload.roomPassword",
          parsed.message.clientMsgId
        );
        return;
      }

      const result = await gameLifecycleService.joinGame({
        roomName,
        roomPassword,
        clientId: connection.clientId,
        playerId: connection.playerId,
        socketId: socket.id
      });

      if (!result.ok) {
        emitProtocolError(
          socket,
          MESSAGE_TYPES.GAME_JOIN,
          "game_join",
          startedAtMs,
          "error",
          result.error.code,
          result.error.message,
          parsed.message.clientMsgId
        );
        return;
      }

      const session = result.session;
      connectionRegistry.setActiveGame(socket.id, session.gameId);
      const roomChannelName = broadcastService.getGameRoomName(session.gameId);

      socket.join(roomChannelName);

      broadcastService.sendToSocket(
        socket,
        MESSAGE_TYPES.GAME_JOINED,
        createServerMessage(
          MESSAGE_TYPES.GAME_JOINED,
          {
            gameId: session.gameId,
            roomName: session.roomName,
            assignedColour: result.assignedColour
          },
          parsed.message.clientMsgId
        )
      );

      if (result.gameStarted) {
        broadcastService.broadcastToGame(
          io,
          session.gameId,
          MESSAGE_TYPES.GAME_START,
          createServerMessage(
            MESSAGE_TYPES.GAME_START,
            {
              gameId: session.gameId,
              turnColour: session.turnColour
            },
            parsed.message.clientMsgId
          )
        );
      }

      broadcastService.broadcastToGame(
        io,
        session.gameId,
        MESSAGE_TYPES.STATE_SYNC,
        createServerMessage(
          MESSAGE_TYPES.STATE_SYNC,
          syncService.buildStateSyncPayload(session),
          parsed.message.clientMsgId
        )
      );
      finishHandlerMetrics(MESSAGE_TYPES.GAME_JOIN, "game_join", startedAtMs, "accepted");
    } catch (error) {
      console.error("[gameHandlers:GAME_JOIN] Unhandled exception:", error);
      finishHandlerMetrics(
        MESSAGE_TYPES.GAME_JOIN,
        "game_join",
        startedAtMs,
        "exception",
        ERROR_CODES.INTERNAL_ERROR
      );
      emitInternalError(socket, rawMessage?.clientMsgId);
    }
  });

  socket.on(MESSAGE_TYPES.MOVE_SUBMIT, async (rawMessage) => {
    let parsed = null;
    const startedAtMs = Date.now();
    recordSocketMessage(MESSAGE_TYPES.MOVE_SUBMIT, "received");

    try {
      parsed = parseEnvelope(rawMessage);

      if (!parsed.ok) {
        emitProtocolError(
          socket,
          MESSAGE_TYPES.MOVE_SUBMIT,
          "move_submit",
          startedAtMs,
          "invalid",
          parsed.error.code,
          parsed.error.message
        );
        return;
      }

      const connection = requireInitialisedConnection(
        socket,
        parsed.message.clientMsgId
      );
      if (!connection) return;

      const payload = parsed.message.payload || {};
      const gameId = payload.gameId || connection.activeGameId || null;
      const { expectedRevision, uci } = payload;

      if (!gameId || typeof expectedRevision !== "number" || !uci) {
        emitProtocolError(
          socket,
          MESSAGE_TYPES.MOVE_SUBMIT,
          "move_submit",
          startedAtMs,
          "invalid",
          ERROR_CODES.INVALID_MESSAGE_FORMAT,
          "MOVE_SUBMIT requires payload.gameId, payload.expectedRevision, and payload.uci",
          parsed.message.clientMsgId
        );
        return;
      }

      logHandlerEvent("MOVE_SUBMIT:received", {
        socketId: socket.id,
        clientId: connection.clientId,
        playerId: connection.playerId,
        gameId,
        expectedRevision,
        uci,
        clientMsgId: parsed.message.clientMsgId
      });

      const result = await moveService.applyMove({
        gameId,
        playerId: connection.playerId,
        expectedRevision,
        uci
      });

      logHandlerEvent("MOVE_SUBMIT:service_result", {
        gameId,
        expectedRevision,
        uci,
        ok: result?.ok,
        errorType: result?.errorType,
        errorCode: result?.error?.code,
        sessionRevision: result?.session?.revision,
        sessionState: result?.session?.state,
        sessionResult: result?.session?.result
      });

      if (!result.ok) {
        emitMoveFailure(socket, parsed.message.clientMsgId, result, startedAtMs);
        return;
      }

      const session = result.session;

      broadcastService.sendToSocket(
        socket,
        MESSAGE_TYPES.MOVE_ACCEPTED,
        createServerMessage(
          MESSAGE_TYPES.MOVE_ACCEPTED,
          {
            gameId: session.gameId,
            revision: session.revision,
            move: result.appliedMove
          },
          parsed.message.clientMsgId
        )
      );

      logHandlerEvent("MOVE_SUBMIT:before_state_update_broadcast", {
        gameId: session.gameId,
        revision: session.revision,
        state: session.state,
        result: session.result,
        fen: session.fen
      });

      broadcastService.broadcastToGame(
        io,
        session.gameId,
        MESSAGE_TYPES.STATE_UPDATE,
        createServerMessage(
          MESSAGE_TYPES.STATE_UPDATE,
          {
            gameId: session.gameId,
            roomName: session.roomName,
            state: session.state,
            revision: session.revision,
            fen: session.fen,
            turnColour: session.turnColour,
            result: session.result,
            players: session.players,
            moveHistory: session.moveHistory,
            lastMove: result.appliedMove
          },
          parsed.message.clientMsgId
        )
      );

      if (session.state === "FINISHED" && session.result) {
        logHandlerEvent("MOVE_SUBMIT:before_game_concluded_broadcast", {
          gameId: session.gameId,
          revision: session.revision,
          result: session.result
        });

        broadcastService.broadcastToGame(
          io,
          session.gameId,
          MESSAGE_TYPES.GAME_CONCLUDED,
          createServerMessage(
            MESSAGE_TYPES.GAME_CONCLUDED,
            {
              gameId: session.gameId,
              result: session.result,
              reason: session.result.includes("CHECKMATE")
                ? "CHECKMATE"
                : session.result.startsWith("DRAW")
                  ? "DRAW"
                  : "TERMINAL",
              winner:
                session.result.startsWith("WHITE_") ? "white" :
                session.result.startsWith("BLACK_") ? "black" :
                null,
              fen: session.fen,
              revision: session.revision
            },
            parsed.message.clientMsgId
          )
        );

        broadcastService.broadcastToGame(
          io,
          session.gameId,
          MESSAGE_TYPES.STATE_SYNC,
          createServerMessage(
            MESSAGE_TYPES.STATE_SYNC,
            syncService.buildStateSyncPayload(session),
            parsed.message.clientMsgId
          )
        );
      }

      finishHandlerMetrics(MESSAGE_TYPES.MOVE_SUBMIT, "move_submit", startedAtMs, "accepted");
      logHandlerEvent("MOVE_SUBMIT:completed", {
        gameId: session.gameId,
        revision: session.revision,
        state: session.state,
        result: session.result,
        clientMsgId: parsed.message.clientMsgId
      });
    } catch (error) {
      console.error("[gameHandlers:MOVE_SUBMIT] Unhandled exception:", {
        error,
        socketId: socket.id,
        rawMessage
      });
      finishHandlerMetrics(
        MESSAGE_TYPES.MOVE_SUBMIT,
        "move_submit",
        startedAtMs,
        "exception",
        ERROR_CODES.INTERNAL_ERROR
      );

      emitInternalError(
        socket,
        parsed?.message?.clientMsgId,
        "Unexpected failure while processing MOVE_SUBMIT"
      );
    }
  });

  socket.on(MESSAGE_TYPES.RESIGN, async (rawMessage) => {
    const startedAtMs = Date.now();
    recordSocketMessage(MESSAGE_TYPES.RESIGN, "received");
    try {
      const parsed = parseEnvelope(rawMessage);

      if (!parsed.ok) {
        emitProtocolError(
          socket,
          MESSAGE_TYPES.RESIGN,
          "resign",
          startedAtMs,
          "invalid",
          parsed.error.code,
          parsed.error.message
        );
        return;
      }

      const connection = requireInitialisedConnection(
        socket,
        parsed.message.clientMsgId
      );
      if (!connection) return;

      const gameId = parsed.message.payload?.gameId || connection.activeGameId;

      if (!gameId) {
        emitProtocolError(
          socket,
          MESSAGE_TYPES.RESIGN,
          "resign",
          startedAtMs,
          "invalid",
          ERROR_CODES.INVALID_MESSAGE_FORMAT,
          "RESIGN requires payload.gameId",
          parsed.message.clientMsgId
        );
        return;
      }

      const result = await gameLifecycleService.resignGame({
        gameId,
        playerId: connection.playerId
      });

      if (!result.ok) {
        emitProtocolError(
          socket,
          MESSAGE_TYPES.RESIGN,
          "resign",
          startedAtMs,
          "error",
          result.error.code,
          result.error.message,
          parsed.message.clientMsgId
        );
        return;
      }

      const session = result.session;

      broadcastService.broadcastToGame(
        io,
        session.gameId,
        MESSAGE_TYPES.GAME_CONCLUDED,
        createServerMessage(
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
          parsed.message.clientMsgId
        )
      );

      broadcastService.broadcastToGame(
        io,
        session.gameId,
        MESSAGE_TYPES.STATE_SYNC,
        createServerMessage(
          MESSAGE_TYPES.STATE_SYNC,
          syncService.buildStateSyncPayload(session),
          parsed.message.clientMsgId
        )
      );
      finishHandlerMetrics(MESSAGE_TYPES.RESIGN, "resign", startedAtMs, "accepted");
    } catch (error) {
      console.error("[gameHandlers:RESIGN] Unhandled exception:", error);
      finishHandlerMetrics(
        MESSAGE_TYPES.RESIGN,
        "resign",
        startedAtMs,
        "exception",
        ERROR_CODES.INTERNAL_ERROR
      );
      emitInternalError(socket, rawMessage?.clientMsgId);
    }
  });

  socket.on(MESSAGE_TYPES.REMATCH_REQUEST, async (rawMessage) => {
    const startedAtMs = Date.now();
    recordSocketMessage(MESSAGE_TYPES.REMATCH_REQUEST, "received");
    try {
      const parsed = parseEnvelope(rawMessage);

      if (!parsed.ok) {
        emitProtocolError(
          socket,
          MESSAGE_TYPES.REMATCH_REQUEST,
          "rematch_request",
          startedAtMs,
          "invalid",
          parsed.error.code,
          parsed.error.message
        );
        return;
      }

      const connection = requireInitialisedConnection(
        socket,
        parsed.message.clientMsgId
      );
      if (!connection) return;

      const gameId = parsed.message.payload?.gameId || connection.activeGameId;

      if (!gameId) {
        emitProtocolError(
          socket,
          MESSAGE_TYPES.REMATCH_REQUEST,
          "rematch_request",
          startedAtMs,
          "invalid",
          ERROR_CODES.INVALID_MESSAGE_FORMAT,
          "REMATCH_REQUEST requires payload.gameId",
          parsed.message.clientMsgId
        );
        return;
      }

      const result = await gameLifecycleService.requestRematch({
        gameId,
        playerId: connection.playerId
      });

      if (!result.ok) {
        emitProtocolError(
          socket,
          MESSAGE_TYPES.REMATCH_REQUEST,
          "rematch_request",
          startedAtMs,
          "error",
          result.error.code,
          result.error.message,
          parsed.message.clientMsgId
        );
        return;
      }

      const session = result.session;

      if (!result.rematchStarted) {
        broadcastService.broadcastToGame(
          io,
          session.gameId,
          MESSAGE_TYPES.REMATCH_STATUS,
          createServerMessage(
            MESSAGE_TYPES.REMATCH_STATUS,
            {
              gameId: session.gameId,
              rematch: session.rematch
            },
            parsed.message.clientMsgId
          )
        );
        finishHandlerMetrics(
          MESSAGE_TYPES.REMATCH_REQUEST,
          "rematch_request",
          startedAtMs,
          "accepted"
        );
        return;
      }

      broadcastService.broadcastToGame(
        io,
        session.gameId,
        MESSAGE_TYPES.REMATCH_START,
        createServerMessage(
          MESSAGE_TYPES.REMATCH_START,
          {
            gameId: session.gameId,
            roomName: session.roomName
          },
          parsed.message.clientMsgId
        )
      );

      broadcastService.broadcastToGame(
        io,
        session.gameId,
        MESSAGE_TYPES.STATE_SYNC,
        createServerMessage(
          MESSAGE_TYPES.STATE_SYNC,
          syncService.buildStateSyncPayload(session),
          parsed.message.clientMsgId
        )
      );
      finishHandlerMetrics(
        MESSAGE_TYPES.REMATCH_REQUEST,
        "rematch_request",
        startedAtMs,
        "accepted"
      );
    } catch (error) {
      console.error("[gameHandlers:REMATCH_REQUEST] Unhandled exception:", error);
      finishHandlerMetrics(
        MESSAGE_TYPES.REMATCH_REQUEST,
        "rematch_request",
        startedAtMs,
        "exception",
        ERROR_CODES.INTERNAL_ERROR
      );
      emitInternalError(socket, rawMessage?.clientMsgId);
    }
  });

  socket.on(MESSAGE_TYPES.GAME_RESUME, async (rawMessage) => {
    const startedAtMs = Date.now();
    recordSocketMessage(MESSAGE_TYPES.GAME_RESUME, "received");
    try {
      const parsed = parseEnvelope(rawMessage);

      if (!parsed.ok) {
        emitProtocolError(
          socket,
          MESSAGE_TYPES.GAME_RESUME,
          "game_resume",
          startedAtMs,
          "invalid",
          parsed.error.code,
          parsed.error.message
        );
        return;
      }

      const connection = requireInitialisedConnection(
        socket,
        parsed.message.clientMsgId
      );
      if (!connection) return;

      const gameId = parsed.message.payload?.gameId;

      if (!gameId) {
        emitProtocolError(
          socket,
          MESSAGE_TYPES.GAME_RESUME,
          "game_resume",
          startedAtMs,
          "invalid",
          ERROR_CODES.INVALID_MESSAGE_FORMAT,
          "GAME_RESUME requires payload.gameId",
          parsed.message.clientMsgId
        );
        return;
      }

      const result = await gameLifecycleService.resumeGame({
        gameId,
        clientId: connection.clientId,
        socketId: socket.id
      });

      if (!result.ok) {
        emitProtocolError(
          socket,
          MESSAGE_TYPES.GAME_RESUME,
          "game_resume",
          startedAtMs,
          "error",
          result.error.code,
          result.error.message,
          parsed.message.clientMsgId
        );
        return;
      }

      const session = result.session;
      connectionRegistry.setActiveGame(socket.id, session.gameId);
      const roomChannelName = broadcastService.getGameRoomName(session.gameId);

      socket.join(roomChannelName);

      const reconnectedPlayerId = result.reconnectedPlayerId;
      const opponent =
        session.players.white?.playerId === reconnectedPlayerId
          ? session.players.black
          : session.players.white;

      if (opponent && opponent.socketId) {
        const opponentSocket = io.sockets.sockets.get(opponent.socketId);

        if (opponentSocket) {
          broadcastService.sendToSocket(
            opponentSocket,
            MESSAGE_TYPES.PLAYER_RECONNECTED,
            createServerMessage(
              MESSAGE_TYPES.PLAYER_RECONNECTED,
              {
                gameId: session.gameId,
                playerId: reconnectedPlayerId
              },
              parsed.message.clientMsgId
            )
          );
        }
      }

      broadcastService.sendToSocket(
        socket,
        MESSAGE_TYPES.GAME_RESUMED,
        createServerMessage(
          MESSAGE_TYPES.GAME_RESUMED,
          {
            gameId: session.gameId,
            assignedColour: result.assignedColour
          },
          parsed.message.clientMsgId
        )
      );

      broadcastService.sendToSocket(
        socket,
        MESSAGE_TYPES.STATE_SYNC,
        createServerMessage(
          MESSAGE_TYPES.STATE_SYNC,
          syncService.buildStateSyncPayload(session),
          parsed.message.clientMsgId
        )
      );
      finishHandlerMetrics(MESSAGE_TYPES.GAME_RESUME, "game_resume", startedAtMs, "accepted");
    } catch (error) {
      console.error("[gameHandlers:GAME_RESUME] Unhandled exception:", error);
      finishHandlerMetrics(
        MESSAGE_TYPES.GAME_RESUME,
        "game_resume",
        startedAtMs,
        "exception",
        ERROR_CODES.INTERNAL_ERROR
      );
      emitInternalError(socket, rawMessage?.clientMsgId);
    }
  });
}

module.exports = registerGameHandlers;
