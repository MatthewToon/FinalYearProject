/*
 * Shared constants for the decomposed services.
 *
 * These values mirror the monolith so both architectures keep the same
 * externally visible behaviour while the internal structure changes.
 */

const SESSION_STATES = {
  NO_SESSION: "NO_SESSION",
  WAITING_FOR_PLAYERS: "WAITING_FOR_PLAYERS",
  IN_PROGRESS: "IN_PROGRESS",
  FINISHED: "FINISHED"
};

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const ROOM_PREFIX = "game:";

module.exports = {
  SESSION_STATES,
  START_FEN,
  ROOM_PREFIX
};
