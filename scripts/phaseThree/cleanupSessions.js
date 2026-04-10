/*
 * Script: cleanupSessions
 *
 * This is a small development/testing script used during the project.
 * Read the code below to see which server event or workflow it exercises.
 */

const { pool } = require("../../server/monolith/src/persistence/db");

async function run() {
  console.log("Starting cleanup...");

  const staleWaitingResult = await pool.query(`
    DELETE FROM games
    WHERE state = 'WAITING_FOR_PLAYERS'
      AND created_at < NOW() - INTERVAL '24 hours'
    RETURNING game_id
  `);

  const oldFinishedResult = await pool.query(`
    DELETE FROM games
    WHERE state = 'FINISHED'
      AND updated_at < NOW() - INTERVAL '7 days'
    RETURNING game_id
  `);

  console.log(`Deleted stale waiting games: ${staleWaitingResult.rowCount}`);
  console.log(`Deleted old finished games: ${oldFinishedResult.rowCount}`);

  if (staleWaitingResult.rowCount > 0) {
    console.log("Waiting game IDs:");
    console.log(staleWaitingResult.rows.map((row) => row.game_id));
  }

  if (oldFinishedResult.rowCount > 0) {
    console.log("Finished game IDs:");
    console.log(oldFinishedResult.rows.map((row) => row.game_id));
  }

  await pool.end();
}

run().catch((error) => {
  console.error("Cleanup failed:", error);
  process.exit(1);
});
