const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:3001";

let gameId = null;
let currentRevision = 0;
let reconnectClient = null;

// =====================
// HELPER: submit move safely
// =====================
function submitMove(client, label, uci) {
  console.log(`[${label}] submitting move: ${uci} (rev=${currentRevision})`);

  client.emit("MOVE_SUBMIT", {
    type: "MOVE_SUBMIT",
    clientMsgId: `${label}-${uci}-${Date.now()}`,
    payload: {
      gameId,
      expectedRevision: currentRevision,
      uci
    }
  });
}

// =====================
// CLIENT 1 (WHITE)
// =====================
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
  console.log("[client1] WELCOME");

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
  console.log("[client1] STATE_UPDATE (rev:", currentRevision, ")");
});

client1.on("MOVE_ACCEPTED", () => {
  console.log("[client1] MOVE_ACCEPTED");
});

// =====================
// CLIENT 2 (BLACK)
// =====================
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
  console.log("[client2] WELCOME");

  const interval = setInterval(() => {
    if (gameId) {
      clearInterval(interval);

      client2.emit("GAME_JOIN", {
        type: "GAME_JOIN",
        clientMsgId: "c2-join",
        payload: { gameId }
      });
    }
  }, 200);
});

client2.on("GAME_JOINED", () => {
  console.log("[client2] GAME_JOINED");
});

client2.on("GAME_START", () => {
  console.log("[client2] GAME_START");
});

client2.on("STATE_SYNC", (msg) => {
  currentRevision = msg.payload.revision;
  console.log("[client2] STATE_SYNC (rev:", currentRevision, ")");
});

client2.on("STATE_UPDATE", (msg) => {
  currentRevision = msg.payload.revision;
  console.log("[client2] STATE_UPDATE (rev:", currentRevision, ")");
});

client2.on("MOVE_ACCEPTED", () => {
  console.log("[client2] MOVE_ACCEPTED");
});

client2.on("PLAYER_RECONNECTED", (msg) => {
  console.log("[client2] PLAYER_RECONNECTED:", msg.payload);
});

// =====================
// OPENING SEQUENCE
// =====================

// 1. e4
setTimeout(() => {
  submitMove(client1, "client1", "e2e4");
}, 3000);

// 1... e5
setTimeout(() => {
  submitMove(client2, "client2", "e7e5");
}, 4500);

// 2. Nf3
setTimeout(() => {
  submitMove(client1, "client1", "g1f3");
}, 6000);

// =====================
// DISCONNECT WHITE MID-GAME
// =====================
setTimeout(() => {
  console.log("\n--- Disconnecting client1 mid-game ---\n");
  client1.disconnect();
}, 7500);

// =====================
// RECONNECT WHITE
// =====================
setTimeout(() => {
  console.log("\n--- Reconnecting client1 ---\n");

  reconnectClient = io(SERVER_URL);

  reconnectClient.on("connect", () => {
    reconnectClient.emit("HELLO", {
      type: "HELLO",
      clientMsgId: "c1-reconnect",
      payload: {
        clientId: "client-1",
        playerId: "player-1"
      }
    });
  });

  reconnectClient.on("WELCOME", () => {
    reconnectClient.emit("GAME_RESUME", {
      type: "GAME_RESUME",
      clientMsgId: "c1-resume",
      payload: { gameId }
    });
  });

  reconnectClient.on("GAME_RESUMED", () => {
    console.log("[client1-reconnect] GAME_RESUMED");
  });

  reconnectClient.on("STATE_SYNC", (msg) => {
    currentRevision = msg.payload.revision;

    console.log(
      "[client1-reconnect] STATE_SYNC (rev:",
      currentRevision,
      ")"
    );

    console.log(
      "[client1-reconnect] moveHistory length:",
      msg.payload.moveHistory.length
    );
  });

  reconnectClient.on("STATE_UPDATE", (msg) => {
    currentRevision = msg.payload.revision;
    console.log("[client1-reconnect] STATE_UPDATE (rev:", currentRevision, ")");
  });

  reconnectClient.on("MOVE_ACCEPTED", () => {
    console.log("[client1-reconnect] MOVE_ACCEPTED");
  });
}, 9500);

// =====================
// CONTINUE GAME AFTER RECONNECT
// =====================

// 2... Nc6
setTimeout(() => {
  submitMove(client2, "client2", "b8c6");
}, 11500);

// 3. Bc4
setTimeout(() => {
  if (reconnectClient) {
    submitMove(reconnectClient, "client1-reconnect", "f1c4");
  }
}, 13000);

// 3... Bc5
setTimeout(() => {
  submitMove(client2, "client2", "f8c5");
}, 14500);

// =====================
// END TEST
// =====================
setTimeout(() => {
  console.log("\n--- Test complete ---\n");

  if (reconnectClient) reconnectClient.disconnect();
  client2.disconnect();

  process.exit(0);
}, 17000);