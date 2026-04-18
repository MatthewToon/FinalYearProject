/*
 * Disconnect handler.
 *
 * This handler responds to Socket.IO disconnect events. It removes the socket
 * from the connection registry, delegates session-level disconnect handling to
 * the disconnect service, and emits PLAYER_LEFT / STATE_SYNC to the remaining
 * player(s) if the disconnected socket belonged to an active game.
 */

const MESSAGE_TYPES = require("../protocol/messageTypes");
const { createServerMessage } = require("../protocol/envelope");
const connectionRegistry = require("../connection/connectionRegistry");
const disconnectService = require("../services/disconnectService");
const broadcastService = require("../services/broadcastService");
const syncService = require("../services/syncService");
const {
  recordSocketMessage,
  recordOperationDuration
} = require("../metrics/latency");

function registerDisconnectHandler(io, socket) {
  socket.on("disconnect", async () => {
    const startedAtMs = Date.now();
    recordSocketMessage("DISCONNECT", "received");

    const result = await disconnectService.handleDisconnect(socket.id);

    connectionRegistry.removeSocket(socket.id);

    if (!result.session || !result.disconnectedPlayerId) {
      recordSocketMessage("DISCONNECT", "accepted");
      recordOperationDuration("disconnect", startedAtMs);
      return;
    }

    const session = result.session;

    broadcastService.broadcastToGame(
      io,
      session.gameId,
      MESSAGE_TYPES.PLAYER_LEFT,
      createServerMessage(MESSAGE_TYPES.PLAYER_LEFT, {
        gameId: session.gameId,
        playerId: result.disconnectedPlayerId
      })
    );

    broadcastService.broadcastToGame(
      io,
      session.gameId,
      MESSAGE_TYPES.STATE_SYNC,
      createServerMessage(
        MESSAGE_TYPES.STATE_SYNC,
        syncService.buildStateSyncPayload(session)
      )
    );
    recordSocketMessage("DISCONNECT", "accepted");
    recordOperationDuration("disconnect", startedAtMs);
  });
}

module.exports = registerDisconnectHandler;
