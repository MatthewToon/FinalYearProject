/**
 * Integration Test #2 - HELLO -> GAME_CREATE.
 *
 * Purpose:
 * - connect to the monolith Socket.IO server
 * - complete the HELLO / WELCOME handshake
 * - send GAME_CREATE
 * - verify that GAME_CREATED is received
 * - verify that STATE_SYNC is received
 *
 */

const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:3001";

const socket = io(SERVER_URL);

let receivedWelcome = false;
let receivedGameCreated = false;
let receivedStateSync = false;

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
  receivedWelcome = true;

  console.log("\nWELCOME received:");
  console.dir(message, { depth: null });

  socket.emit("GAME_CREATE", {
    type: "GAME_CREATE",
    clientMsgId: "msg-002",
    clientTimeMs: Date.now(),
    payload: {}
  });
});

socket.on("GAME_CREATED", (message) => {
  receivedGameCreated = true;

  console.log("\nGAME_CREATED received:");
  console.dir(message, { depth: null });
});

socket.on("STATE_SYNC", (message) => {
  receivedStateSync = true;

  console.log("\nSTATE_SYNC received:");
  console.dir(message, { depth: null });

  console.log("\nTest summary:");
  console.log("- WELCOME received:", receivedWelcome);
  console.log("- GAME_CREATED received:", receivedGameCreated);
  console.log("- STATE_SYNC received:", receivedStateSync);

  socket.disconnect();
});

socket.on("ERROR", (message) => {
  console.log("\nERROR received:");
  console.dir(message, { depth: null });
  socket.disconnect();
});

socket.on("connect_error", (error) => {
  console.error("\nConnection error:");
  console.error(error.message);
});

socket.on("disconnect", () => {
  console.log("\nDisconnected");
});