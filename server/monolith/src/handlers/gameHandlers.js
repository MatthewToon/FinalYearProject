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
 *
 * Responsibilities:
 * - Validate incoming protocol envelope
 * - Ensure HELLO handshake has completed
 * - Delegate to appropriate service layer
 * - Emit protocol responses (success or error)
 *
 * NOTE:
 * This file should NOT contain business logic — only orchestration.
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
  //
  // Flow:
  // 1. Validate message format
  // 2. Ensure connection initialised
  // 3. Call lifecycle service
  // 4. Join socket to game room
  // 5. Send GAME_CREATED
  // 6. Send initial STATE_SYNC
  // ==========================================================================

  socket.on(MESSAGE_TYPES.GAME_CREATE, (rawMessage) => {
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

    const result = gameLifecycleService.createGame({
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
    const roomName = broadcastService.getGameRoomName(session.gameId);

    // Join socket to game room
    socket.join(roomName);

    // Send GAME_CREATED to creator
    broadcastService.sendToSocket(
      socket,
      MESSAGE_TYPES.GAME_CREATED,
      createServerMessage(
        MESSAGE_TYPES.GAME_CREATED,
        {
          gameId: session.gameId,
          assignedColour: "white"
        },
        parsed.message.clientMsgId
      )
    );

    // Send initial state snapshot
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
  //
  // Flow:
  // 1. Validate message format
  // 2. Ensure connection initialised
  // 3. Validate payload (gameId)
  // 4. Call lifecycle service
  // 5. Join socket to room
  // 6. Send GAME_JOINED to joining player
  // 7. If second player → broadcast GAME_START
  // 8. Broadcast updated STATE_SYNC to both players
  // ==========================================================================

  socket.on(MESSAGE_TYPES.GAME_JOIN, (rawMessage) => {
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
          "GAME_JOIN requires payload.gameId",
          parsed.message.clientMsgId
        )
      );
      return;
    }

    const result = gameLifecycleService.joinGame({
      gameId,
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
    const roomName = broadcastService.getGameRoomName(session.gameId);

    // Join socket to game room
    socket.join(roomName);

    // Send GAME_JOINED to joining player
    broadcastService.sendToSocket(
      socket,
      MESSAGE_TYPES.GAME_JOINED,
      createServerMessage(
        MESSAGE_TYPES.GAME_JOINED,
        {
          gameId: session.gameId,
          assignedColour: result.assignedColour
        },
        parsed.message.clientMsgId
      )
    );

    // If game now ready → broadcast GAME_START
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

    // Broadcast updated state to all players
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
  //
  // Flow:
  // 1. Validate message format
  // 2. Ensure connection initialised
  // 3. Validate payload (gameId, revision, uci)
  // 4. Call move service
  // 5. On success:
  //    - send MOVE_ACCEPTED to submitting player
  //    - broadcast STATE_UPDATE to all players
  // 6. On failure:
  //    - send MOVE_REJECTED or ERROR
  // ==========================================================================

  socket.on(MESSAGE_TYPES.MOVE_SUBMIT, (rawMessage) => {
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

    const result = moveService.applyMove({
      gameId,
      playerId: connection.playerId,
      expectedRevision,
      uci
    });

    // Handle rejection
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

    // Send MOVE_ACCEPTED to submitting player
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

    // Broadcast updated state to all players
    broadcastService.broadcastToGame(
      io,
      session.gameId,
      MESSAGE_TYPES.STATE_UPDATE,
      createServerMessage(
        MESSAGE_TYPES.STATE_UPDATE,
        {
          gameId: session.gameId,
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
}

module.exports = registerGameHandlers;