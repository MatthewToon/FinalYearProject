/*
 * Shared configuration constants used by the monolith backend.
 *
 * This file contains values that are stable across the application, such as:
 * - session/game states
 * - the standard starting chess position
 * - naming conventions for Socket.IO rooms
 *
 * Keeping these in one place avoids repeated string literals and makes it
 * easier to keep the implementation aligned with the protocol and SRS.
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