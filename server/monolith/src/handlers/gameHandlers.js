/*
 * ============================================================================
 * GAME HANDLERS (Protocol Entry Layer)
 * ============================================================================
 *
 * Handles all incoming game-related WebSocket messages.
 *
 * Supported message flows:
 * - GAME_CREATE
 * - GAME_JOIN
 * - MOVE_SUBMIT
 * - GAME_RESUME
 * - REMATCH_REQUEST
 * - RESIGN
 *
 * Responsibilities:
 * - Validate incoming protocol envelope
 * - Ensure HELLO handshake has completed
 * - Delegate to appropriate service layer
 * - Emit protocol responses (success or error)
 *
 * NOTE:
 * This file should NOT contain business logic - only orchestration.
 * All service calls are asynchronous and must be awaited
 * ============================================================================
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

/*
 * ============================================================================
 * HELPER: REQUIRE INITIALISED CONNECTION
 * ============================================================================
 *
 * Ensures the socket has completed the HELLO handshake before allowing any
 * further protocol messages.
 */
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

/*
 * ============================================================================
 * MAIN REGISTRATION FUNCTION
 * ============================================================================
 *
 * Attaches all protocol handlers to a connected socket.
 */
function registerGameHandlers(io, socket) {
  // ==========================================================================
  // HANDLER: GAME_CREATE
  // ==========================================================================

  socket.on(MESSAGE_TYPES.GAME_CREATE, async (rawMessage) => {
    const parsed = parseEnvelope(rawMessage);

    if (!parsed.ok) {
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
  });

  // ==========================================================================
  // HANDLER: GAME_JOIN
  // ==========================================================================

  socket.on(MESSAGE_TYPES.GAME_JOIN, async (rawMessage) => {
    const parsed = parseEnvelope(rawMessage);

    if (!parsed.ok) {
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
      socket.emit(
        MESSAGE_TYPES.ERROR,
        createErrorMessage(
          ERROR_CODES.INVALID_MESSAGE_FORMAT,
          "GAME_JOIN requires payload.roomName and payload.roomPassword",
          parsed.message.clientMsgId
        )
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
  });

  // ==========================================================================
  // HANDLER: MOVE_SUBMIT
  // ==========================================================================

  socket.on(MESSAGE_TYPES.MOVE_SUBMIT, async (rawMessage) => {
    const parsed = parseEnvelope(rawMessage);

    if (!parsed.ok) {
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

    const { gameId, expectedRevision, uci } = parsed.message.payload || {};

    if (!gameId || typeof expectedRevision !== "number" || !uci) {
      socket.emit(
        MESSAGE_TYPES.ERROR,
        createErrorMessage(
          ERROR_CODES.INVALID_MESSAGE_FORMAT,
          "MOVE_SUBMIT requires payload.gameId, payload.expectedRevision, and payload.uci",
          parsed.message.clientMsgId
        )
      );
      return;
    }

    const result = await moveService.applyMove({
      gameId,
      playerId: connection.playerId,
      expectedRevision,
      uci
    });

    if (!result.ok) {
      const messageType =
        result.errorType === "MOVE_REJECTED"
          ? MESSAGE_TYPES.MOVE_REJECTED
          : MESSAGE_TYPES.ERROR;

      socket.emit(
        messageType,
        createServerMessage(
          messageType,
          {
            code: result.error.code,
            message: result.error.message
          },
          parsed.message.clientMsgId
        )
      );
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
  });

  // ==========================================================================
  // HANDLER: RESIGN
  // ==========================================================================
  //
  // Flow:
  // 1. Validate message format
  // 2. Ensure connection initialised
  // 3. Validate payload (gameId)
  // 4. Call lifecycle service
  // 5. Broadcast GAME_CONCLUDED
  // 6. Broadcast refreshed STATE_SYNC
  // ==========================================================================

  socket.on(MESSAGE_TYPES.RESIGN, async (rawMessage) => {
    const parsed = parseEnvelope(rawMessage);

    if (!parsed.ok) {
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

    const gameId = parsed.message.payload?.gameId;

    if (!gameId) {
      socket.emit(
        MESSAGE_TYPES.ERROR,
        createErrorMessage(
          ERROR_CODES.INVALID_MESSAGE_FORMAT,
          "RESIGN requires payload.gameId",
          parsed.message.clientMsgId
        )
      );
      return;
    }

    const result = await gameLifecycleService.resignGame({
      gameId,
      playerId: connection.playerId
    });

    if (!result.ok) {
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
  });

  // ==========================================================================
  // HANDLER: REMATCH_REQUEST
  // ==========================================================================

  socket.on(MESSAGE_TYPES.REMATCH_REQUEST, async (rawMessage) => {
    const parsed = parseEnvelope(rawMessage);

    if (!parsed.ok) {
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

    const gameId = parsed.message.payload?.gameId;

    if (!gameId) {
      socket.emit(
        MESSAGE_TYPES.ERROR,
        createErrorMessage(
          ERROR_CODES.INVALID_MESSAGE_FORMAT,
          "REMATCH_REQUEST requires payload.gameId",
          parsed.message.clientMsgId
        )
      );
      return;
    }

    const result = await gameLifecycleService.requestRematch({
      gameId,
      playerId: connection.playerId
    });

    if (!result.ok) {
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
  });

  // ==========================================================================
  // HANDLER: GAME_RESUME
  // ==========================================================================

  socket.on(MESSAGE_TYPES.GAME_RESUME, async (rawMessage) => {
    const parsed = parseEnvelope(rawMessage);

    if (!parsed.ok) {
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

    const gameId = parsed.message.payload?.gameId;

    if (!gameId) {
      socket.emit(
        MESSAGE_TYPES.ERROR,
        createErrorMessage(
          ERROR_CODES.INVALID_MESSAGE_FORMAT,
          "GAME_RESUME requires payload.gameId",
          parsed.message.clientMsgId
        )
      );
      return;
    }

    const result = await gameLifecycleService.resumeGame({
      gameId,
      clientId: connection.clientId,
      socketId: socket.id
    });

    if (!result.ok) {
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
  });
}

module.exports = registerGameHandlers;