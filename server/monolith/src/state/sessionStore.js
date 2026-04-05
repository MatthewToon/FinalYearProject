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
 * Note: All DB operations are async, callers must use `await`.
 */

const { pool } = require("../config/database");

const sessions = new Map();

function mapRowToSession(row) {
  return {
    gameId: row.game_id,
    roomName: row.room_name,
    roomPassword: row.room_password,
    state: row.state,
    revision: row.revision,
    fen: row.fen,
    turnColour: row.turn_colour,
    players: {
      white: row.white_player_id
        ? {
            clientId: row.white_client_id,
            playerId: row.white_player_id,
            socketId: null,
            connected: false
          }
        : null,
      black: row.black_player_id
        ? {
            clientId: row.black_client_id,
            playerId: row.black_player_id,
            socketId: null,
            connected: false
          }
        : null
    },
    rematch: {
      white: row.white_rematch_requested,
      black: row.black_rematch_requested
    },
    result: row.result,
    moveHistory: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMoveRowsToMoveHistory(rows) {
  return rows.map((row) => ({
    uci: row.uci,
    san: row.san,
    from: null,
    to: null,
    piece: null,
    promotion: null,
    revision: row.revision_applied,
    submittedBy: row.player_id,
    createdAt: row.created_at
  }));
}

async function getMoveHistoryForGame(gameId) {
  const movesResult = await pool.query(
    `
      SELECT *
      FROM moves
      WHERE game_id = $1
      ORDER BY revision_applied ASC
    `,
    [gameId]
  );

  return mapMoveRowsToMoveHistory(movesResult.rows);
}

async function loadSessionsFromDatabase() {
  const result = await pool.query(`
    SELECT *
    FROM games
    ORDER BY created_at ASC
  `);

  sessions.clear();

  for (const row of result.rows) {
    const session = mapRowToSession(row);
    session.moveHistory = await getMoveHistoryForGame(row.game_id);
    sessions.set(session.gameId, session);
  }
}

async function createSession(session) {
  session.updatedAt = new Date().toISOString();

  await pool.query(
    `
      INSERT INTO games (
        game_id,
        room_name,
        room_password,
        state,
        revision,
        fen,
        turn_colour,
        white_player_id,
        black_player_id,
        white_client_id,
        black_client_id,
        white_rematch_requested,
        black_rematch_requested,
        result,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    `,
    [
      session.gameId,
      session.roomName,
      session.roomPassword,
      session.state,
      session.revision,
      session.fen,
      session.turnColour,
      session.players?.white?.playerId || null,
      session.players?.black?.playerId || null,
      session.players?.white?.clientId || null,
      session.players?.black?.clientId || null,
      session.rematch?.white || false,
      session.rematch?.black || false,
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
    return cached;
  }

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
  session.moveHistory = await getMoveHistoryForGame(gameId);

  sessions.set(session.gameId, session);
  return session;
}

async function getSessionByRoomName(roomName) {
  for (const session of sessions.values()) {
    if (session.roomName === roomName) {
      return session;
    }
  }

  const result = await pool.query(
    `
      SELECT *
      FROM games
      WHERE room_name = $1
    `,
    [roomName]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const session = mapRowToSession(result.rows[0]);
  session.moveHistory = await getMoveHistoryForGame(session.gameId);

  sessions.set(session.gameId, session);
  return session;
}

async function saveSession(session) {
  session.updatedAt = new Date().toISOString();

  await pool.query(
    `
      UPDATE games
      SET
        room_name = $2,
        room_password = $3,
        state = $4,
        revision = $5,
        fen = $6,
        turn_colour = $7,
        white_player_id = $8,
        black_player_id = $9,
        white_client_id = $10,
        black_client_id = $11,
        white_rematch_requested = $12,
        black_rematch_requested = $13,
        result = $14,
        updated_at = $15
      WHERE game_id = $1
    `,
    [
      session.gameId,
      session.roomName,
      session.roomPassword,
      session.state,
      session.revision,
      session.fen,
      session.turnColour,
      session.players?.white?.playerId || null,
      session.players?.black?.playerId || null,
      session.players?.white?.clientId || null,
      session.players?.black?.clientId || null,
      session.rematch?.white || false,
      session.rematch?.black || false,
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
  getSessionByRoomName,
  saveSession,
  getSessionCount,
  findSessionBySocketId,
  loadSessionsFromDatabase
};