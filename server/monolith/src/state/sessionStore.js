/**
 * In-memory authoritative session store.
 *
 * This file stores active game sessions for the monolith runtime.
 * It acts as the authoritative source of live session state while the process
 * is running, and will later sit alongside PostgreSQL persistence.
 *
 * It supports:
 * - creating a session
 * - reading a session by game ID
 * - updating/saving a session
 */

const sessions = new Map();

function createSession(session) {
  sessions.set(session.gameId, session);
  return session;
}

function getSession(gameId) {
  return sessions.get(gameId) || null;
}

function saveSession(session) {
  session.updatedAt = new Date().toISOString();
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