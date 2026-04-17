/*
 * Gateway-local connection registry.
 *
 * The gateway owns browser sockets, so connection-level identity stays local
 * to this service even though game and lifecycle work are delegated inward.
 */

const connections = new Map();

function registerSocket(socketId) {
  connections.set(socketId, {
    socketId,
    initialised: false,
    clientId: null,
    playerId: null,
    activeGameId: null,
    connectedAt: Date.now()
  });
}

function markInitialised(socketId, data = {}) {
  const existing = connections.get(socketId);
  if (!existing) return null;

  const updated = {
    ...existing,
    initialised: true,
    clientId: data.clientId || null,
    playerId: data.playerId || null
  };

  connections.set(socketId, updated);
  return updated;
}

function setActiveGame(socketId, gameId) {
  const existing = connections.get(socketId);
  if (!existing) return null;

  const updated = {
    ...existing,
    activeGameId: gameId || null
  };

  connections.set(socketId, updated);
  return updated;
}

function getConnection(socketId) {
  return connections.get(socketId) || null;
}

function removeSocket(socketId) {
  connections.delete(socketId);
}

function getConnectionCount() {
  return connections.size;
}

module.exports = {
  registerSocket,
  markInitialised,
  setActiveGame,
  getConnection,
  removeSocket,
  getConnectionCount
};
