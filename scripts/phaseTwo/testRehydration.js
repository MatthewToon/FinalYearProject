/*
 * Script: testRehydration
 *
 * This is a small development/testing script used during the project.
 * Read the code below to see which server event or workflow it exercises.
 */

const sessionStore = require("../../server/monolith/src/state/sessionStore");

async function run() {
  const gameId = process.argv[2];

  if (!gameId) {
    console.error("Usage: node scripts/phaseTwo/testRehydration.js <gameId>");
    process.exit(1);
  }

  const session = await sessionStore.getSession(gameId);

  if (!session) {
    console.error("Session not found");
    process.exit(1);
  }

  console.log("Rehydrated session:");
  console.log(JSON.stringify(session, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
