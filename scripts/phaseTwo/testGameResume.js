// Script: testGameResume
// This is a small development/testing script used during the project.
// Read the code below to see which server event or workflow it exercises.

const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:3001";

// IMPORTANT: Use previously created gameID
const GAME_ID = "3ec750ce-f493-4e4c-b71a-c8fd12fabb8e";

if (!GAME_ID) {
  console.error("Usage: node testGameResume.js <gameId>");
  process.exit(1);
}

// Use SAME IDs as before restart
const CLIENT_ID = "client-1";
const PLAYER_ID = "player-1";

const socket = io(SERVER_URL);

socket.on("connect", () => {
  console.log("Connected:", socket.id);

  // Step 1: HELLO
  socket.emit("HELLO", {
    type: "HELLO",
    clientMsgId: "msg-001",
    payload: {
      clientId: CLIENT_ID,
      playerId: PLAYER_ID
    }
  });
});

socket.on("WELCOME", () => {
  console.log("WELCOME received");

  // Step 2: RESUME GAME
  socket.emit("GAME_RESUME", {
    type: "GAME_RESUME",
    clientMsgId: "msg-002",
    payload: {
      gameId: GAME_ID
    }
  });
});

socket.on("GAME_RESUMED", (msg) => {
  console.log("\nGAME_RESUMED received:");
  console.log(msg);
});

socket.on("STATE_SYNC", (msg) => {
  console.log("\nSTATE_SYNC received:");
  console.log(JSON.stringify(msg, null, 2));
});

socket.on("ERROR", (err) => {
  console.log("\nERROR received:");
  console.log(err);
});

socket.on("disconnect", () => {
  console.log("Disconnected");
});

socket.on("PLAYER_RECONNECTED", (msg) => {
  console.log("\nPLAYER_RECONNECTED received:");
  console.log(msg);
});