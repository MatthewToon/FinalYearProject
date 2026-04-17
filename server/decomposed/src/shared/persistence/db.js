/*
 * Shared PostgreSQL pool for the decomposed services.
 */

const { Pool } = require("pg");
const { loadEnv } = require("../config/env");

const env = loadEnv(process.env.CHESS_SERVICE_NAME || "gateway");

const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl:
    env.nodeEnv === "production"
      ? {
          rejectUnauthorized: false
        }
      : false
});

module.exports = {
  pool
};
