// Protocol error code definitions.
// This file centralises the error codes used by the application protocol so
// that handlers and services can refer to a single shared set of values.

module.exports = {
  INVALID_MESSAGE_FORMAT: "INVALID_MESSAGE_FORMAT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  UNAUTHORISED_CONNECTION: "UNAUTHORISED_CONNECTION",
  DUPLICATE_MESSAGE: "DUPLICATE_MESSAGE",

  GAME_NOT_FOUND: "GAME_NOT_FOUND",
  GAME_FULL: "GAME_FULL",

  INVALID_GAME_STATE: "INVALID_GAME_STATE",
  PLAYER_NOT_IN_GAME: "PLAYER_NOT_IN_GAME",
  NOT_YOUR_TURN: "NOT_YOUR_TURN",
  STALE_REVISION: "STALE_REVISION",
  ILLEGAL_MOVE: "ILLEGAL_MOVE"
};
