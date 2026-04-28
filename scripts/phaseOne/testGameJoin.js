// Integration Test #3 - HELLO -> GAME_CREATE -> 2nd client HELLO -> GAME_JOIN.
// Purpose:
// - create a game with client 1
// - join the game with client 2
// - verify GAME_JOINED is returned to client 2
// - verify both clients receive GAME_START
// - verify both clients receive updated STATE_SYNC

const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:3001";

const client1 = io(SERVER_URL);
const client2 = io(SERVER_URL, {
  autoConnect: false
});

let gameId = null;

client1.on("connect", () => {
  console.log("[client1] Connected:", client1.id);

  client1.emit("HELLO", {
    type: "HELLO",
    clientMsgId: "c1-msg-001",
    clientTimeMs: Date.now(),
    payload: {
      clientId: "client-1",
      playerId: "player-1"
    }
  });
});

client1.on("WELCOME", (message) => {
  console.log("\n[client1] WELCOME received:");
  console.dir(message, { depth: null });

  client1.emit("GAME_CREATE", {
    type: "GAME_CREATE",
    clientMsgId: "c1-msg-002",
    clientTimeMs: Date.now(),
    payload: {}
  });
});

client1.on("GAME_CREATED", (message) => {
  console.log("\n[client1] GAME_CREATED received:");
  console.dir(message, { depth: null });

  gameId = message.payload.gameId;
});

client1.on("STATE_SYNC", (message) => {
  console.log("\n[client1] STATE_SYNC received:");
  console.dir(message, { depth: null });

  if (gameId && !client2.connected) {
    client2.connect();
  }
});

client1.on("GAME_START", (message) => {
  console.log("\n[client1] GAME_START received:");
  console.dir(message, { depth: null });
});

client1.on("ERROR", (message) => {
  console.log("\n[client1] ERROR received:");
  console.dir(message, { depth: null });
});

client2.on("connect", () => {
  console.log("[client2] Connected:", client2.id);

  client2.emit("HELLO", {
    type: "HELLO",
    clientMsgId: "c2-msg-001",
    clientTimeMs: Date.now(),
    payload: {
      clientId: "client-2",
      playerId: "player-2"
    }
  });
});

client2.on("WELCOME", (message) => {
  console.log("\n[client2] WELCOME received:");
  console.dir(message, { depth: null });

  client2.emit("GAME_JOIN", {
    type: "GAME_JOIN",
    clientMsgId: "c2-msg-002",
    clientTimeMs: Date.now(),
    payload: {
      gameId
    }
  });
});

client2.on("GAME_JOINED", (message) => {
  console.log("\n[client2] GAME_JOINED received:");
  console.dir(message, { depth: null });
});

client2.on("STATE_SYNC", (message) => {
  console.log("\n[client2] STATE_SYNC received:");
  console.dir(message, { depth: null });

  if (message.payload.state === "IN_PROGRESS") {
    setTimeout(() => {
      client1.disconnect();
      client2.disconnect();
    }, 500);
  }
});

client2.on("GAME_START", (message) => {
  console.log("\n[client2] GAME_START received:");
  console.dir(message, { depth: null });
});

client2.on("ERROR", (message) => {
  console.log("\n[client2] ERROR received:");
  console.dir(message, { depth: null });
});

client1.on("disconnect", () => {
  console.log("\n[client1] Disconnected");
});

client2.on("disconnect", () => {
  console.log("\n[client2] Disconnected");
});