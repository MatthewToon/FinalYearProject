const connectionRegistry = require("../connection/connectionRegistry");
const registerHelloHandlers = require("./helloHandlers");
const registerDisconnectHandler = require("./disconnectHandler");

function registerHandlers(io) {
  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    connectionRegistry.registerSocket(socket.id);

    registerHelloHandlers(io, socket);
    registerDisconnectHandler(io, socket);
  });
}

module.exports = registerHandlers;