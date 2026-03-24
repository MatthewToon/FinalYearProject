/**
 * Central Socket.IO handler registration.
 *
 * This file is responsible for attaching per-socket event handlers whenever
 * a new client connects. It also performs initial socket registration in the
 * connection registry before protocol-specific handlers are used.
 */

const connectionRegistry = require("../connection/connectionRegistry");
const registerHelloHandlers = require("./helloHandlers");
const registerDisconnectHandler = require("./disconnectHandler");
const registerGameHandlers = require("./gameHandlers");

function registerHandlers(io) {
  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    connectionRegistry.registerSocket(socket.id);

    registerHelloHandlers(io, socket);
    registerGameHandlers(io, socket);
    registerDisconnectHandler(io, socket);
  });
}

module.exports = registerHandlers;