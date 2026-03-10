require("dotenv").config();

function requireEnv(name, fallback = undefined) {
  const value = process.env[name] ?? fallback;

  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3001),

  databaseUrl: requireEnv("DATABASE_URL"),

  pgHost: process.env.PGHOST || "localhost",
  pgPort: Number(process.env.PGPORT || 5432),
  pgDatabase: process.env.PGDATABASE || "chess_db",
  pgUser: process.env.PGUSER || "chess",
  pgPassword: process.env.PGPASSWORD || "chess",

  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",

  clientOrigin: process.env.CLIENT_ORIGIN || "*"
};

module.exports = env;