// Primary PostgreSQL pool for the monolith.
// Most backend code imports this pool when it needs to query the database.
// The connection string itself comes from config/env.
// This file is the single source of truth for database access in the monolith.

const { Pool } = require("pg");
const env = require("../config/env");

const pool = new Pool({
  connectionString: env.databaseUrl
});

async function testDatabaseConnection() {
  const client = await pool.connect();

  try {
    const result = await client.query("SELECT NOW()");
    console.log("[database] Connected to PostgreSQL");
    console.log("[database] Server time:", result.rows[0].now);
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  testDatabaseConnection
};