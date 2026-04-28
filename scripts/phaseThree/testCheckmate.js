// Script: testCheckmate
// This is a small development/testing script used during the project.
// Read the code below to see which server event or workflow it exercises.

const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:3001";

let gameId = null;
let currentRevision = 0;

// CLIENT 1 (WHITE)
const client1 = io(SERVER_URL);

client1.on("connect", () => {
  console.log("[client1] Connected:", client1.id);

  client1.emit("HELLO", {
    type: "HELLO",
    clientMsgId: "c1-hello",
    payload: {
      clientId: "client-1",
      playerId: "player-1"
    }
  });
});

client1.on("WELCOME", () => {
  client1.emit("GAME_CREATE", {
    type: "GAME_CREATE",
    clientMsgId: "c1-create",
    payload: {}
  });
});

client1.on("GAME_CREATED", (msg) => {
  gameId = msg.payload.gameId;
  console.log("[client1] GAME_CREATED:", gameId);
});

client1.on("STATE_SYNC", (msg) => {
  currentRevision = msg.payload.revision;
  console.log("[client1] STATE_SYNC (rev:", currentRevision, ")");
});

client1.on("STATE_UPDATE", (msg) => {
  currentRevision = msg.payload.revision;

  console.log("[client1] STATE_UPDATE:", {
    revision: currentRevision,
    state: msg.payload.state,
    result: msg.payload.result
  });
});

client1.on("MOVE_ACCEPTED", () => {
  console.log("[client1] MOVE_ACCEPTED");
});

// CLIENT 2 (BLACK)
const client2 = io(SERVER_URL);

client2.on("connect", () => {
  console.log("[client2] Connected:", client2.id);

  client2.emit("HELLO", {
    type: "HELLO",
    clientMsgId: "c2-hello",
    payload: {
      clientId: "client-2",
      playerId: "player-2"
    }
  });
});

client2.on("WELCOME", () => {
  const interval = setInterval(() => {
    if (gameId) {
      clearInterval(interval);

      client2.emit("GAME_JOIN", {
        type: "GAME_JOIN",
        clientMsgId: "c2-join",
        payload: { gameId }
      });
    }
  }, 100);
});

client2.on("STATE_SYNC", (msg) => {
  currentRevision = msg.payload.revision;
  console.log("[client2] STATE_SYNC (rev:", currentRevision, ")");
});

client2.on("STATE_UPDATE", (msg) => {
  currentRevision = msg.payload.revision;

  console.log("[client2] STATE_UPDATE:", {
    revision: currentRevision,
    state: msg.payload.state,
    result: msg.payload.result
  });
});

client2.on("MOVE_ACCEPTED", () => {
  console.log("[client2] MOVE_ACCEPTED");
});

// FOOL'S MATE SEQUENCE

function submitMove(socket, move, label) {
  console.log(`[${label}] submitting move: ${move} (rev=${currentRevision})`);

  socket.emit("MOVE_SUBMIT", {
    type: "MOVE_SUBMIT",
    clientMsgId: `${label}-${move}`,
    payload: {
      gameId,
      expectedRevision: currentRevision,
      uci: move
    }
  });
}

// Move sequence:
// 1. f2f3
// 2. e7e5
// 3. g2g4
// 4. d8h4 (checkmate)

setTimeout(() => submitMove(client1, "f2f3", "client1"), 2000);
setTimeout(() => submitMove(client2, "e7e5", "client2"), 3000);
setTimeout(() => submitMove(client1, "g2g4", "client1"), 4000);
setTimeout(() => submitMove(client2, "d8h4", "client2"), 5000);

// Finish
setTimeout(() => {
  console.log("\n--- Test complete ---");
  client1.disconnect();
  client2.disconnect();
}, 7000);