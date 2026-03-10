const connections = new Map();

function registerSocket(socketId) {
  connections.set(socketId, {
    socketId,
    initialised: false,
    clientId: null,
    playerId: null,
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
  getConnection,
  removeSocket,
  getConnectionCount
};