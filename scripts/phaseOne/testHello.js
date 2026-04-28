// Integration Test #1 - Minimal handshake test

const { io } = require("socket.io-client");

const socket = io("http://localhost:3001");

socket.on("connect", () => {
  console.log("Connected:", socket.id);

  socket.emit("HELLO", {
    type: "HELLO",
    clientMsgId: "msg-001",
    clientTimeMs: Date.now(),
    payload: {
      clientId: "client-123",
      playerId: "player-123"
    }
  });
});

socket.on("WELCOME", (message) => {
  console.log("WELCOME received:");
  console.dir(message, { depth: null });
  socket.disconnect();
});

socket.on("ERROR", (message) => {
  console.log("ERROR received:");
  console.dir(message, { depth: null });
  socket.disconnect();
});

socket.on("disconnect", () => {
  console.log("Disconnected");
});