const connectionRegistry = require("../connection/connectionRegistry");

function registerDisconnectHandler(io, socket) {
  socket.on("disconnect", () => {
    connectionRegistry.removeSocket(socket.id);
    console.log(`Socket disconnected: ${socket.id}`);
  });
}

module.exports = registerDisconnectHandler;