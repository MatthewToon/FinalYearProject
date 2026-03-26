const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:3001";

const gameIdArg = process.argv[2];

let gameId = gameIdArg || null;

const client1 = io(SERVER_URL);
const client2 = io(SERVER_URL);

// --------------------
// CLIENT 1
// --------------------
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
  if (!gameId) {
    client1.emit("GAME_CREATE", {
      type: "GAME_CREATE",
      clientMsgId: "c1-create",
      payload: {}
    });
  } else {
    // Resume instead of create
    client1.emit("GAME_RESUME", {
      type: "GAME_RESUME",
      clientMsgId: "c1-resume",
      payload: { gameId }
    });
  }
});

client1.on("GAME_CREATED", (msg) => {
  console.log("[client1] GAME_CREATED");
  gameId = msg.payload.gameId;
});

client1.on("STATE_SYNC", () => {
  console.log("[client1] STATE_SYNC");

  // Simulate disconnect after initial sync
  if (!gameIdArg) {
    console.log("[client1] Simulating disconnect...");
    client1.disconnect();
  }
});

client1.on("GAME_RESUMED", () => {
  console.log("[client1] GAME_RESUMED");
});

// --------------------
// CLIENT 2
// --------------------
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
  // Wait for gameId then join
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

client2.on("PLAYER_RECONNECTED", (msg) => {
  console.log("[client2] PLAYER_RECONNECTED received:");
  console.log(msg);
});

// --------------------
// RECONNECT CLIENT 1
// --------------------
setTimeout(() => {
  if (gameId) {
    console.log("[client1] Reconnecting...");

    const reconnectClient = io(SERVER_URL);

    reconnectClient.on("connect", () => {
      reconnectClient.emit("HELLO", {
        type: "HELLO",
        clientMsgId: "c1-hello-reconnect",
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
  }
}, 3000);