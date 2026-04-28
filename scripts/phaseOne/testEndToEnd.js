// End-to-end monolith communication flow test.
// This test validates the full baseline protocol flow:
// - HELLO / WELCOME
// - GAME_CREATE
// - GAME_JOIN
// - GAME_START
// - white MOVE_SUBMIT
// - black MOVE_SUBMIT
// - STATE_UPDATE after each accepted move
// - disconnect handling
// - PLAYER_LEFT
// - final STATE_SYNC
// This acts as the final integration checkpoint for the monolith
// communication-flow implementation stage.

const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:3001";

const client1 = io(SERVER_URL);
const client2 = io(SERVER_URL, { autoConnect: false });

let gameId = null;
let client2Started = false;
let whiteMoveSent = false;
let blackMoveSent = false;
let blackDisconnected = false;

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

  if (gameId && !client2Started) {
    client2Started = true;
    client2.connect();
  }
});

client1.on("GAME_START", (message) => {
  console.log("\n[client1] GAME_START received:");
  console.dir(message, { depth: null });

  if (!whiteMoveSent) {
    whiteMoveSent = true;

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
  }
});

client1.on("MOVE_ACCEPTED", (message) => {
  console.log("\n[client1] MOVE_ACCEPTED received:");
  console.dir(message, { depth: null });
});

client1.on("STATE_UPDATE", (message) => {
  console.log("\n[client1] STATE_UPDATE received:");
  console.dir(message, { depth: null });
});

client1.on("PLAYER_LEFT", (message) => {
  console.log("\n[client1] PLAYER_LEFT received:");
  console.dir(message, { depth: null });
});

client1.on("ERROR", (message) => {
  console.log("\n[client1] ERROR received:");
  console.dir(message, { depth: null });
});

client1.on("MOVE_REJECTED", (message) => {
  console.log("\n[client1] MOVE_REJECTED received:");
  console.dir(message, { depth: null });
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

client2.on("GAME_START", (message) => {
  console.log("\n[client2] GAME_START received:");
  console.dir(message, { depth: null });
});

client2.on("MOVE_ACCEPTED", (message) => {
  console.log("\n[client2] MOVE_ACCEPTED received:");
  console.dir(message, { depth: null });
});

client2.on("STATE_SYNC", (message) => {
  console.log("\n[client2] STATE_SYNC received:");
  console.dir(message, { depth: null });
});

client2.on("STATE_UPDATE", (message) => {
  console.log("\n[client2] STATE_UPDATE received:");
  console.dir(message, { depth: null });

  // After white's move, black should move.
  if (
    message.payload.revision === 1 &&
    !blackMoveSent &&
    message.payload.turnColour === "black"
  ) {
    blackMoveSent = true;

    client2.emit("MOVE_SUBMIT", {
      type: "MOVE_SUBMIT",
      clientMsgId: "c2-msg-003",
      clientTimeMs: Date.now(),
      payload: {
        gameId,
        expectedRevision: 1,
        uci: "e7e5"
      }
    });

    return;
  }

  // After black's move, disconnect black to test partial failure handling.
  if (
    message.payload.revision === 2 &&
    !blackDisconnected &&
    message.payload.turnColour === "white"
  ) {
    blackDisconnected = true;

    setTimeout(() => {
      client2.disconnect();
    }, 400);
  }
});

client2.on("ERROR", (message) => {
  console.log("\n[client2] ERROR received:");
  console.dir(message, { depth: null });
});

client2.on("MOVE_REJECTED", (message) => {
  console.log("\n[client2] MOVE_REJECTED received:");
  console.dir(message, { depth: null });
});

client2.on("disconnect", () => {
  console.log("\n[client2] Disconnected");

  setTimeout(() => {
    client1.disconnect();
  }, 800);
});