/*
 * Shared UCI parsing helpers.
 *
 * Converts a protocol-level UCI move string (for example "e2e4" or "e7e8q")
 * into the object shape expected by chess.js.
 */

const ERROR_CODES = require("./errorCodes");

function parseUciMove(uci) {
  if (typeof uci !== "string") {
    return {
      ok: false,
      error: {
        code: ERROR_CODES.INVALID_MESSAGE_FORMAT,
        message: "Move must be a string in UCI format"
      }
    };
  }

  const trimmed = uci.trim().toLowerCase();
  const isValidUci = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(trimmed);

  if (!isValidUci) {
    return {
      ok: false,
      error: {
        code: ERROR_CODES.INVALID_MESSAGE_FORMAT,
        message: "Move must be valid UCI, for example e2e4 or e7e8q"
      }
    };
  }

  const move = {
    from: trimmed.slice(0, 2),
    to: trimmed.slice(2, 4)
  };

  if (trimmed.length === 5) {
    move.promotion = trimmed[4];
  }

  return {
    ok: true,
    move
  };
}

module.exports = {
  parseUciMove
};
