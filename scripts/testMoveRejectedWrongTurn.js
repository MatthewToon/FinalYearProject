/**
 * Negative-path integration test:
 * black attempts to move first before white has moved.
 *
 * Expected result:
 * - server rejects the move with MOVE_REJECTED
 * - rejection code should be NOT_YOUR_TURN
 */

const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:3001";

const client1 = io(SERVER_URL);
const client2 = io(SERVER_URL, { autoConnect: false });

let gameId = null;
let client2Started = false;
let blackMoveSent = false;

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

client2.on("GAME_START", () => {
  if (!blackMoveSent) {
    blackMoveSent = true;

    client2.emit("MOVE_SUBMIT", {
      type: "MOVE_SUBMIT",
      clientMsgId: "c2-msg-003",
      clientTimeMs: Date.now(),
      payload: {
        gameId,
        expectedRevision: 0,
        uci: "e7e5"
      }
    });
  }
});

client2.on("MOVE_REJECTED", (message) => {
  console.log("\n[client2] MOVE_REJECTED received:");
  console.dir(message, { depth: null });

  setTimeout(() => {
    client1.disconnect();
    client2.disconnect();
  }, 300);
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