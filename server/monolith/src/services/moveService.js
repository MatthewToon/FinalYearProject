/*
 * Move submission service.
 *
 * This service applies chess moves to the authoritative in-memory game
 * session. It is responsible for:
 * - validating that a move can be submitted in the current state
 * - checking the submitted revision
 * - checking turn ownership
 * - validating the move using chess.js
 * - updating authoritative session state
 * - incrementing the revision
 *
 * It does not emit socket events directly; handlers do that.
 */

const { Chess } = require("chess.js");
const sessionStore = require("../state/sessionStore");
const stateMachine = require("../state/stateMachine");
const { parseUciMove } = require("../protocol/uci");
const ERROR_CODES = require("../protocol/errorCodes");
const { pool } = require("../config/database");
const { SESSION_STATES, START_FEN } = require("../config/constants");

function buildChessFromSessionHistory(session) {
  
  const startingFen = session.initialFen || START_FEN;
  const chess = new Chess(startingFen);

  for (const move of session.moveHistory) {
    const applied = chess.move(move.uci, { sloppy: true });

    if (!applied) {
      throw new Error(
        `Failed to rebuild chess history for game ${session.gameId} at move ${move.uci}`
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

async function applyMove({ gameId, playerId, expectedRevision, uci }) {
  const session = await sessionStore.getSession(gameId);

  if (!session) {
    return {
      ok: false,
      errorType: "ERROR",
      error: {
        code: ERROR_CODES.GAME_NOT_FOUND,
        message: "The requested game does not exist"
      }
    };
  }

  if (!stateMachine.canSubmitMove(session)) {
    return {
      ok: false,
      errorType: "ERROR",
      error: {
        code: ERROR_CODES.INVALID_GAME_STATE,
        message: "Moves can only be submitted while the game is in progress"
      }
    };
  }

  const playerColour = stateMachine.getPlayerColour(session, playerId);

  if (!playerColour) {
    return {
      ok: false,
      errorType: "ERROR",
      error: {
        code: ERROR_CODES.PLAYER_NOT_IN_GAME,
        message: "The submitting player is not part of this game"
      }
    };
  }

  if (expectedRevision !== session.revision) {
    return {
      ok: false,
      errorType: "MOVE_REJECTED",
      error: {
        code: ERROR_CODES.STALE_REVISION,
        message: `Expected revision ${session.revision}, received ${expectedRevision}`
      }
    };
  }

  if (!stateMachine.isPlayersTurn(session, playerId)) {
    return {
      ok: false,
      errorType: "MOVE_REJECTED",
      error: {
        code: ERROR_CODES.NOT_YOUR_TURN,
        message: `It is currently ${session.turnColour}'s turn`
      }
    };
  }

  const parsedMove = parseUciMove(uci);

  if (!parsedMove.ok) {
    return {
      ok: false,
      errorType: "ERROR",
      error: parsedMove.error
    };
  }

  let chess;

  try {
    chess = buildChessFromSessionHistory(session);
  } catch (error) {
    return {
      ok: false,
      errorType: "ERROR",
      error: {
        code: ERROR_CODES.INVALID_GAME_STATE,
        message: "Failed to reconstruct game history for move validation"
      }
    };
  }

  if (chess.fen() !== session.fen) {
    return {
      ok: false,
      errorType: "ERROR",
      error: {
        code: ERROR_CODES.INVALID_GAME_STATE,
        message: "Persisted session state does not match reconstructed move history"
      }
    };
  }

  let appliedMove;

  try {
    appliedMove = chess.move(parsedMove.move);
  } catch (error) {
    return {
      ok: false,
      errorType: "MOVE_REJECTED",
      error: {
        code: ERROR_CODES.ILLEGAL_MOVE,
        message: "The submitted move is not legal in the current position"
      }
    };
  }

  if (!appliedMove) {
    return {
      ok: false,
      errorType: "MOVE_REJECTED",
      error: {
        code: ERROR_CODES.ILLEGAL_MOVE,
        message: "The submitted move is not legal in the current position"
      }
    };
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

  await sessionStore.saveSession(session);

  return {
    ok: true,
    session,
    appliedMove: {
      uci,
      san: appliedMove.san,
      from: appliedMove.from,
      to: appliedMove.to,
      promotion: appliedMove.promotion || null
    }
  };
}

module.exports = {
  applyMove
};