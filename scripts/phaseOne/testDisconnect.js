// Step 5 integration test client:
// HELLO -> GAME_CREATE -> second client HELLO -> GAME_JOIN -> disconnect client 2.
// Purpose:
// - verify disconnect handling preserves session state
// - verify PLAYER_LEFT is broadcast
// - verify updated STATE_SYNC marks the disconnected player correctly

const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:3001";

const client1 = io(SERVER_URL);
const client2 = io(SERVER_URL, { autoConnect: false });

let gameId = null;
let client2Started = false;
let disconnected = false;

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

client1.on("WELCOME", () => {
  client1.emit("GAME_CREATE", {
    type: "GAME_CREATE",
    clientMsgId: "c1-msg-002",
    clientTimeMs: Date.now(),
    payload: {}
  });
});

client1.on("GAME_CREATED", (message) => {
  gameId = message.payload.gameId;
});

client1.on("STATE_SYNC", (message) => {
  console.log("\n[client1] STATE_SYNC received:");
  console.dir(message, { depth: null });

  if (gameId && !client2Started) {
    client2Started = true;
    client2.connect();
  }
});

client1.on("PLAYER_LEFT", (message) => {
  console.log("\n[client1] PLAYER_LEFT received:");
  console.dir(message, { depth: null });
});

client1.on("GAME_START", () => {
  if (!disconnected) {
    disconnected = true;
    setTimeout(() => {
      client2.disconnect();
    }, 300);
  }
});

client1.on("disconnect", () => {
  console.log("\n[client1] Disconnected");
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

client2.on("WELCOME", () => {
  client2.emit("GAME_JOIN", {
    type: "GAME_JOIN",
    clientMsgId: "c2-msg-002",
    clientTimeMs: Date.now(),
    payload: {
      gameId
    }
  });
});

client2.on("disconnect", () => {
  console.log("\n[client2] Disconnected");
  setTimeout(() => {
    client1.disconnect();
  }, 800);
});