// Script: testSessionStore
// This is a small development/testing script used during the project.
// Read the code below to see which server event or workflow it exercises.

const sessionStore = require("../../server/monolith/src/state/sessionStore");
const { randomUUID } = require("crypto");

async function run() {
  const gameId = randomUUID();

  const session = {
    gameId,
    state: "WAITING_FOR_PLAYERS",
    revision: 0,
    fen: "start",
    turnColour: null,
    players: {
      white: { playerId: "player-1", socketId: "socket-1" },
      black: null
    },
    result: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await sessionStore.createSession(session);

  const loaded = await sessionStore.getSession(gameId);
  console.log("Loaded session:", loaded);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});