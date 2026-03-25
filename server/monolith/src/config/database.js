const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "localhost",
  port: Number(process.env.POSTGRES_PORT || 5433),
  user: process.env.POSTGRES_USER || "chess",
  password: process.env.POSTGRES_PASSWORD || "chess",
  database: process.env.POSTGRES_DB || "chess_db"
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