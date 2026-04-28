// Redis client creation helper.

const { createClient } = require("redis");

async function createRedisClients(redisUrl) {
  const command = createClient({ url: redisUrl });
  const publisher = command.duplicate();
  const subscriber = command.duplicate();

  await command.connect();
  await publisher.connect();
  await subscriber.connect();

  return {
    command,
    publisher,
    subscriber
  };
}

module.exports = {
  createRedisClients
};