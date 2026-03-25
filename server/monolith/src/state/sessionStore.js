/*
 * Session store with PostgreSQL persistence.
 *
 * Extends the original in-memory store by adding a database-backed layer.
 * Active sessions are cached in memory for fast access, while PostgreSQL
 * provides durable storage and enables recovery after server restarts.
 *
 * - Writes (create/save) update both DB and in-memory cache
 * - Reads prefer cache, with DB fallback if needed
 * - Socket-related data remains in-memory only (not persisted)
 *
 * Note: All DB operations are async — callers must use `await`.
 */

const { pool } = require("../config/database");

const sessions = new Map();

function mapRowToSession(row) {
  return {
    gameId: row.game_id,
    state: row.state,
    revision: row.revision,
    fen: row.fen,
    turnColour: row.turn_colour,
    players: {
      white: row.white_player_id
        ? {
            clientId: null,
            playerId: row.white_player_id,
            socketId: null,
            connected: false
          }
        : null,
      black: row.black_player_id
        ? {
            clientId: null,
            playerId: row.black_player_id,
            socketId: null,
            connected: false
          }
        : null
    },
    result: row.result,
    moveHistory: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function createSession(session) {
  session.updatedAt = new Date().toISOString();

  await pool.query(
    `
      INSERT INTO games (
        game_id,
        state,
        revision,
        fen,
        turn_colour,
        white_player_id,
        black_player_id,
        result,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    [
      session.gameId,
      session.state,
      session.revision,
      session.fen,
      session.turnColour,
      session.players?.white?.playerId || null,
      session.players?.black?.playerId || null,
      session.result || null,
      session.createdAt || new Date().toISOString(),
      session.updatedAt
    ]
  );

  sessions.set(session.gameId, session);
  return session;
}

async function getSession(gameId) {
  const cached = sessions.get(gameId);
  if (cached) {
    console.log("[sessionStore] getSession from cache:", gameId);
    return cached;
  }

  console.log("[sessionStore] getSession from database:", gameId);

  const result = await pool.query(
    `
      SELECT *
      FROM games
      WHERE game_id = $1
    `,
    [gameId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const session = mapRowToSession(result.rows[0]);
  console.log("[sessionStore] mapped DB session:", JSON.stringify(session, null, 2)); // Added for GAME_JOIN troubleshooting
  sessions.set(session.gameId, session);

  return session;
}

async function saveSession(session) {
  session.updatedAt = new Date().toISOString();

  await pool.query(
    `
      UPDATE games
      SET
        state = $2,
        revision = $3,
        fen = $4,
        turn_colour = $5,
        white_player_id = $6,
        black_player_id = $7,
        result = $8,
        updated_at = $9
      WHERE game_id = $1
    `,
    [
      session.gameId,
      session.state,
      session.revision,
      session.fen,
      session.turnColour,
      session.players?.white?.playerId || null,
      session.players?.black?.playerId || null,
      session.result || null,
      session.updatedAt
    ]
  );

  sessions.set(session.gameId, session);
  return session;
}

function getSessionCount() {
  return sessions.size;
}

function findSessionBySocketId(socketId) {
  for (const session of sessions.values()) {
    if (session.players.white && session.players.white.socketId === socketId) {
      return session;
    }

    if (session.players.black && session.players.black.socketId === socketId) {
      return session;
    }
  }

  return null;
}

module.exports = {
  createSession,
  getSession,
  saveSession,
  getSessionCount,
  findSessionBySocketId
};