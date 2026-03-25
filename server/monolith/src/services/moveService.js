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

  const chess = new Chess(session.fen);

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