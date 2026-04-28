// Negative-path integration test:
// valid game setup followed by MOVE_SUBMIT with a stale revision.
// Expected result:
// - server rejects the move with MOVE_REJECTED
// - rejection code should be STALE_REVISION

const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:3001";

const client1 = io(SERVER_URL);
const client2 = io(SERVER_URL, { autoConnect: false });

let gameId = null;
let client2Started = false;
let staleMoveSent = false;

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

client1.on("STATE_SYNC", () => {
  if (gameId && !client2Started) {
    client2Started = true;
    client2.connect();
  }
});

client1.on("GAME_START", () => {
  if (!staleMoveSent) {
    staleMoveSent = true;

    // First valid move to advance revision from 0 to 1
    client1.emit("MOVE_SUBMIT", {
      type: "MOVE_SUBMIT",
      clientMsgId: "c1-msg-003",
      clientTimeMs: Date.now(),
      payload: {
        gameId,
        expectedRevision: 0,
        uci: "e2e4"
      }
    });

    // Then send a stale move using revision 0 again
    setTimeout(() => {
      client1.emit("MOVE_SUBMIT", {
        type: "MOVE_SUBMIT",
        clientMsgId: "c1-msg-004",
        clientTimeMs: Date.now(),
        payload: {
          gameId,
          expectedRevision: 0,
          uci: "d2d4"
        }
      });
    }, 300);
  }
});

client1.on("MOVE_ACCEPTED", (message) => {
  console.log("\n[client1] MOVE_ACCEPTED received:");
  console.dir(message, { depth: null });
});

client1.on("MOVE_REJECTED", (message) => {
  console.log("\n[client1] MOVE_REJECTED received:");
  console.dir(message, { depth: null });

  setTimeout(() => {
    client1.disconnect();
    client2.disconnect();
  }, 300);
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

client2.on("WELCOME", () => {
  client2.emit("GAME_JOIN", {
    type: "GAME_JOIN",
    clientMsgId: "c2-msg-002",
    clientTimeMs: Date.now(),
    payload: { gameId }
  });
});

client1.on("disconnect", () => {
  console.log("\n[client1] Disconnected");
});

client2.on("disconnect", () => {
  console.log("\n[client2] Disconnected");
});