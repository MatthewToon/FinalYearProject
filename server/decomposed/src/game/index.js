process.env.CHESS_SERVICE_NAME = "game";

const express = require("express");
const { Chess } = require("chess.js");

const { loadEnv } = require("../shared/config/env");
const { CHANNELS } = require("../shared/redis/channels");
const { createRedisClients } = require("../shared/redis/clientFactory");
const { pool } = require("../shared/persistence/db");
const sessionRepository = require("../shared/persistence/sessionRepository");
const stateMachine = require("../shared/state/stateMachine");
const { buildStateSyncPayload } = require("../shared/sync/syncPayload");
const { parseUciMove } = require("../shared/protocol/uci");
const MESSAGE_TYPES = require("../shared/protocol/messageTypes");
const ERROR_CODES = require("../shared/protocol/errorCodes");
const { createServerMessage, createErrorMessage } = require("../shared/protocol/envelope");
const { SESSION_STATES, START_FEN } = require("../shared/config/constants");

const env = loadEnv("game");
const app = express();

function emitSocketMessage(socketId, messageType, message) {
  return {
    kind: "emitToSocket",
    socketId,
    messageType,
    message
  };
}

function emitGameMessage(gameId, messageType, message) {
  return {
    kind: "emitToGame",
    gameId,
    messageType,
    message
  };
}

function buildChessFromSessionHistory(session) {
  const startingFen = session.initialFen || START_FEN;
  const chess = new Chess(startingFen);

  for (let i = 0; i < session.moveHistory.length; i += 1) {
    const move = session.moveHistory[i];
    const applied = chess.move(move.uci, { sloppy: true });

    if (!applied) {
      throw new Error(
        `Failed to rebuild chess history for game ${session.gameId} at move index ${i} (${move.uci})`
      );
    }
  }

  return chess;
}

function applyGameCompletionState(session, chess) {
  if (chess.isCheckmate()) {
    session.state = SESSION_STATES.FINISHED;
    const winner = chess.turn() === "w" ? "black" : "white";
    session.result = `${winner.toUpperCase()}_WIN_CHECKMATE`;
    session.turnColour = null;
    return;
  }

  if (chess.isStalemate()) {
    session.state = SESSION_STATES.FINISHED;
    session.result = "DRAW_STALEMATE";
    session.turnColour = null;
    return;
  }

  if (chess.isInsufficientMaterial()) {
    session.state = SESSION_STATES.FINISHED;
    session.result = "DRAW_INSUFFICIENT_MATERIAL";
    session.turnColour = null;
    return;
  }

  if (chess.isThreefoldRepetition()) {
    session.state = SESSION_STATES.FINISHED;
    session.result = "DRAW_THREEFOLD_REPETITION";
    session.turnColour = null;
    return;
  }

  if (chess.isDraw()) {
    session.state = SESSION_STATES.FINISHED;
    session.result = "DRAW";
    session.turnColour = null;
  }
}

function emitError(socketId, code, message, clientMsgId) {
  return {
    actions: [
      emitSocketMessage(
        socketId,
        MESSAGE_TYPES.ERROR,
        createErrorMessage(code, message, clientMsgId)
      )
    ]
  };
}

function emitMoveRejected(socketId, code, message, clientMsgId) {
  return {
    actions: [
      emitSocketMessage(
        socketId,
        MESSAGE_TYPES.MOVE_REJECTED,
        createServerMessage(
          MESSAGE_TYPES.MOVE_REJECTED,
          {
            code,
            message
          },
          clientMsgId
        )
      )
    ]
  };
}

async function applyMove(payload) {
  const { socketId, clientMsgId, playerId, gameId, expectedRevision, uci } = payload;

  if (!gameId || typeof expectedRevision !== "number" || !uci) {
    return emitError(
      socketId,
      ERROR_CODES.INVALID_MESSAGE_FORMAT,
      "MOVE_SUBMIT requires payload.gameId, payload.expectedRevision, and payload.uci",
      clientMsgId
    );
  }

  const session = await sessionRepository.getSession(gameId);

  if (!session) {
    return emitError(socketId, ERROR_CODES.GAME_NOT_FOUND, "The requested game does not exist", clientMsgId);
  }

  if (!stateMachine.canSubmitMove(session)) {
    return emitError(
      socketId,
      ERROR_CODES.INVALID_GAME_STATE,
      "Moves can only be submitted while the game is in progress",
      clientMsgId
    );
  }

  const playerColour = stateMachine.getPlayerColour(session, playerId);

  if (!playerColour) {
    return emitError(
      socketId,
      ERROR_CODES.PLAYER_NOT_IN_GAME,
      "The submitting player is not part of this game",
      clientMsgId
    );
  }

  if (expectedRevision !== session.revision) {
    return emitMoveRejected(
      socketId,
      ERROR_CODES.STALE_REVISION,
      `Expected revision ${session.revision}, received ${expectedRevision}`,
      clientMsgId
    );
  }

  if (!stateMachine.isPlayersTurn(session, playerId)) {
    return emitMoveRejected(
      socketId,
      ERROR_CODES.NOT_YOUR_TURN,
      `It is currently ${session.turnColour}'s turn`,
      clientMsgId
    );
  }

  const parsedMove = parseUciMove(uci);

  if (!parsedMove.ok) {
    return emitError(socketId, parsedMove.error.code, parsedMove.error.message, clientMsgId);
  }

  let chess;

  try {
    chess = buildChessFromSessionHistory(session);
  } catch (error) {
    return emitError(
      socketId,
      ERROR_CODES.INVALID_GAME_STATE,
      "Failed to reconstruct game history for move validation",
      clientMsgId
    );
  }

  if (chess.fen() !== session.fen) {
    return emitError(
      socketId,
      ERROR_CODES.INVALID_GAME_STATE,
      "Persisted session state does not match reconstructed move history",
      clientMsgId
    );
  }

  let appliedMove;

  try {
    appliedMove = chess.move(parsedMove.move);
  } catch (error) {
    return emitMoveRejected(
      socketId,
      ERROR_CODES.ILLEGAL_MOVE,
      "The submitted move is not legal in the current position",
      clientMsgId
    );
  }

  if (!appliedMove) {
    return emitMoveRejected(
      socketId,
      ERROR_CODES.ILLEGAL_MOVE,
      "The submitted move is not legal in the current position",
      clientMsgId
    );
  }

  session.fen = chess.fen();
  session.turnColour = chess.turn() === "w" ? "white" : "black";
  session.revision += 1;

  applyGameCompletionState(session, chess);

  session.moveHistory.push({
    uci,
    san: appliedMove.san,
    from: appliedMove.from,
    to: appliedMove.to,
    piece: appliedMove.piece,
    promotion: appliedMove.promotion || null,
    revision: session.revision,
    submittedBy: playerId,
    createdAt: new Date().toISOString()
  });

  await pool.query(
    `
      INSERT INTO moves (
        game_id,
        revision_applied,
        player_id,
        uci,
        san,
        fen_after
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      session.gameId,
      session.revision,
      playerId,
      uci,
      appliedMove.san,
      session.fen
    ]
  );

  await sessionRepository.saveSession(session);

  const appliedMovePayload = {
    uci,
    san: appliedMove.san,
    from: appliedMove.from,
    to: appliedMove.to,
    promotion: appliedMove.promotion || null
  };

  const actions = [
    emitSocketMessage(
      socketId,
      MESSAGE_TYPES.MOVE_ACCEPTED,
      createServerMessage(
        MESSAGE_TYPES.MOVE_ACCEPTED,
        {
          gameId: session.gameId,
          revision: session.revision,
          move: appliedMovePayload
        },
        clientMsgId
      )
    ),
    emitGameMessage(
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
          lastMove: appliedMovePayload
        },
        clientMsgId
      )
    )
  ];

  if (session.state === SESSION_STATES.FINISHED && session.result) {
    actions.push(
      emitGameMessage(
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
          clientMsgId
        )
      ),
      emitGameMessage(
        session.gameId,
        MESSAGE_TYPES.STATE_SYNC,
        createServerMessage(
          MESSAGE_TYPES.STATE_SYNC,
          buildStateSyncPayload(session),
          clientMsgId
        )
      )
    );
  }

  return { actions };
}

async function startGameService() {
  const redisClients = await createRedisClients(env.redisUrl);

  await redisClients.subscriber.subscribe(CHANNELS.gameRequests, async (rawMessage) => {
    try {
      const request = JSON.parse(rawMessage);
      let response;

      if (request.action === MESSAGE_TYPES.MOVE_SUBMIT) {
        response = await applyMove(request.payload);
      } else {
        response = { actions: [] };
      }

      await redisClients.publisher.publish(
        request.replyTo,
        JSON.stringify({
          requestId: request.requestId,
          actions: response.actions || []
        })
      );
    } catch (error) {
      console.error("[game-service] Failed to handle request:", error);
    }
  });

  app.get("/health", async (req, res) => {
    try {
      const dbResult = await pool.query("SELECT 1 AS ok");
      const redisStatus = await redisClients.command.ping();

      res.status(200).json({
        status: "ok",
        service: "game",
        serverTimeMs: Date.now(),
        db: dbResult.rows[0].ok === 1 ? "up" : "down",
        redis: redisStatus === "PONG" ? "up" : "down"
      });
    } catch (error) {
      res.status(500).json({
        status: "error",
        service: "game",
        serverTimeMs: Date.now(),
        error: error.message
      });
    }
  });

  app.listen(env.port, () => {
    console.log(`Game service listening on port ${env.port}`);
  });
}

startGameService().catch((error) => {
  console.error("[game-service] Failed to start:", error);
  process.exit(1);
});
