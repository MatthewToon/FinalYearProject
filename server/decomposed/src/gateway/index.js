process.env.CHESS_SERVICE_NAME = "gateway";

const crypto = require("crypto");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const { loadEnv } = require("../shared/config/env");
const { createRedisClients } = require("../shared/redis/clientFactory");
const { CHANNELS, getGatewayReplyChannel } = require("../shared/redis/channels");
const MESSAGE_TYPES = require("../shared/protocol/messageTypes");
const ERROR_CODES = require("../shared/protocol/errorCodes");
const {
  parseEnvelope,
  createErrorMessage,
  createServerMessage
} = require("../shared/protocol/envelope");
const { ROOM_PREFIX } = require("../shared/config/constants");
const connectionRegistry = require("./connectionRegistry");

const env = loadEnv("gateway");
const gatewayInstanceId = crypto.randomUUID();
const gatewayReplyChannel = getGatewayReplyChannel(gatewayInstanceId);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: env.clientOrigin
  }
});

const pendingRequests = new Map();

function getGameRoomName(gameId) {
  return `${ROOM_PREFIX}${gameId}`;
}

function sendSocketError(socket, code, message, clientMsgId = null) {
  socket.emit(
    MESSAGE_TYPES.ERROR,
    createErrorMessage(code, message, clientMsgId)
  );
}

function requireInitialisedConnection(socket, clientMsgId) {
  const connection = connectionRegistry.getConnection(socket.id);

  if (!connection || !connection.initialised) {
    sendSocketError(
      socket,
      ERROR_CODES.UNAUTHORISED_CONNECTION,
      "HELLO must be completed before game messages",
      clientMsgId
    );
    return null;
  }

  return connection;
}

async function executeGatewayActions(actions = []) {
  for (const action of actions) {
    if (action.kind === "setActiveGame") {
      connectionRegistry.setActiveGame(action.socketId, action.gameId);
      continue;
    }

    if (action.kind === "joinGameRoom") {
      const socket = io.sockets.sockets.get(action.socketId);
      if (socket) {
        socket.join(getGameRoomName(action.gameId));
      }
      continue;
    }

    if (action.kind === "emitToSocket") {
      const socket = io.sockets.sockets.get(action.socketId);
      if (socket) {
        socket.emit(action.messageType, action.message);
      }
      continue;
    }

    if (action.kind === "emitToGame") {
      io.to(getGameRoomName(action.gameId)).emit(action.messageType, action.message);
    }
  }
}

async function sendInternalRequest(publisher, channel, action, payload) {
  const requestId = crypto.randomUUID();

  const responsePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`Timed out waiting for internal response for ${action}`));
    }, env.requestTimeoutMs);

    pendingRequests.set(requestId, {
      resolve: (response) => {
        clearTimeout(timeout);
        resolve(response);
      },
      reject
    });
  });

  await publisher.publish(
    channel,
    JSON.stringify({
      requestId,
      replyTo: gatewayReplyChannel,
      action,
      payload
    })
  );

  return responsePromise;
}

async function startGateway() {
  const redisClients = await createRedisClients(env.redisUrl);

  await redisClients.subscriber.subscribe(gatewayReplyChannel, (rawMessage) => {
    try {
      const response = JSON.parse(rawMessage);
      const pending = pendingRequests.get(response.requestId);

      if (!pending) {
        return;
      }

      pendingRequests.delete(response.requestId);
      pending.resolve(response);
    } catch (error) {
      console.error("[gateway] Failed to process internal response:", error);
    }
  });

  app.get("/health", async (req, res) => {
    try {
      const redisStatus = await redisClients.command.ping();

      res.status(200).json({
        status: "ok",
        service: "gateway",
        serverTimeMs: Date.now(),
        redis: redisStatus === "PONG" ? "up" : "down",
        activeConnections: connectionRegistry.getConnectionCount()
      });
    } catch (error) {
      res.status(500).json({
        status: "error",
        service: "gateway",
        serverTimeMs: Date.now(),
        error: error.message
      });
    }
  });

  io.on("connection", (socket) => {
    connectionRegistry.registerSocket(socket.id);

    socket.on(MESSAGE_TYPES.HELLO, (rawMessage) => {
      const parsed = parseEnvelope(rawMessage);

      if (!parsed.ok) {
        sendSocketError(socket, parsed.error.code, parsed.error.message);
        return;
      }

      const payload = parsed.message.payload || {};
      const connection = connectionRegistry.markInitialised(socket.id, {
        clientId: payload.clientId || null,
        playerId: payload.playerId || null
      });

      if (!connection) {
        sendSocketError(socket, ERROR_CODES.INTERNAL_ERROR, "Socket is not registered");
        return;
      }

      socket.emit(
        MESSAGE_TYPES.WELCOME,
        createServerMessage(
          MESSAGE_TYPES.WELCOME,
          {
            socketId: socket.id,
            clientId: connection.clientId,
            playerId: connection.playerId,
            message: "Handshake successful"
          },
          parsed.message.clientMsgId
        )
      );
    });

    const handleLifecycleRequest = async (messageType, rawMessage) => {
      const parsed = parseEnvelope(rawMessage);

      if (!parsed.ok) {
        sendSocketError(socket, parsed.error.code, parsed.error.message);
        return;
      }

      const connection = requireInitialisedConnection(socket, parsed.message.clientMsgId);
      if (!connection) return;

      try {
        const response = await sendInternalRequest(
          redisClients.publisher,
          CHANNELS.sessionRequests,
          messageType,
          {
            socketId: socket.id,
            clientMsgId: parsed.message.clientMsgId,
            clientId: connection.clientId,
            playerId: connection.playerId,
            gameId: parsed.message.payload?.gameId || connection.activeGameId,
            roomName: parsed.message.payload?.roomName,
            roomPassword: parsed.message.payload?.roomPassword
          }
        );

        await executeGatewayActions(response.actions);
      } catch (error) {
        sendSocketError(socket, ERROR_CODES.INTERNAL_ERROR, error.message, parsed.message.clientMsgId);
      }
    };

    socket.on(MESSAGE_TYPES.GAME_CREATE, (rawMessage) => {
      handleLifecycleRequest(MESSAGE_TYPES.GAME_CREATE, rawMessage);
    });

    socket.on(MESSAGE_TYPES.GAME_JOIN, (rawMessage) => {
      handleLifecycleRequest(MESSAGE_TYPES.GAME_JOIN, rawMessage);
    });

    socket.on(MESSAGE_TYPES.GAME_RESUME, (rawMessage) => {
      handleLifecycleRequest(MESSAGE_TYPES.GAME_RESUME, rawMessage);
    });

    socket.on(MESSAGE_TYPES.REMATCH_REQUEST, (rawMessage) => {
      handleLifecycleRequest(MESSAGE_TYPES.REMATCH_REQUEST, rawMessage);
    });

    socket.on(MESSAGE_TYPES.RESIGN, (rawMessage) => {
      handleLifecycleRequest(MESSAGE_TYPES.RESIGN, rawMessage);
    });

    socket.on(MESSAGE_TYPES.MOVE_SUBMIT, async (rawMessage) => {
      const parsed = parseEnvelope(rawMessage);

      if (!parsed.ok) {
        sendSocketError(socket, parsed.error.code, parsed.error.message);
        return;
      }

      const connection = requireInitialisedConnection(socket, parsed.message.clientMsgId);
      if (!connection) return;

      try {
        const response = await sendInternalRequest(
          redisClients.publisher,
          CHANNELS.gameRequests,
          MESSAGE_TYPES.MOVE_SUBMIT,
          {
            socketId: socket.id,
            clientMsgId: parsed.message.clientMsgId,
            playerId: connection.playerId,
            gameId: parsed.message.payload?.gameId || connection.activeGameId,
            expectedRevision: parsed.message.payload?.expectedRevision,
            uci: parsed.message.payload?.uci
          }
        );

        await executeGatewayActions(response.actions);
      } catch (error) {
        sendSocketError(socket, ERROR_CODES.INTERNAL_ERROR, error.message, parsed.message.clientMsgId);
      }
    });

    socket.on("disconnect", async () => {
      const connection = connectionRegistry.getConnection(socket.id);

      if (!connection || !connection.initialised || !connection.activeGameId || !connection.playerId) {
        connectionRegistry.removeSocket(socket.id);
        return;
      }

      try {
        const response = await sendInternalRequest(
          redisClients.publisher,
          CHANNELS.sessionRequests,
          "DISCONNECT",
          {
            socketId: socket.id,
            gameId: connection.activeGameId,
            playerId: connection.playerId
          }
        );

        await executeGatewayActions(response.actions);
      } catch (error) {
        console.error("[gateway] Disconnect forwarding failed:", error);
      } finally {
        connectionRegistry.removeSocket(socket.id);
      }
    });
  });

  server.listen(env.port, () => {
    console.log(`Gateway service listening on port ${env.port}`);
  });
}

startGateway().catch((error) => {
  console.error("[gateway] Failed to start:", error);
  process.exit(1);
});
