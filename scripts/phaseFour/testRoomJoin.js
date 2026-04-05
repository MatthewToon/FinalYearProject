const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:3001";

function createMessage(type, clientMsgId, payload) {
  return {
    type,
    clientMsgId,
    payload
  };
}

function connectClient({ clientId, playerId, label }) {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER_URL, {
      transports: ["websocket"]
    });

    const timeout = setTimeout(() => {
      reject(new Error(`[${label}] Timed out during connect/HELLO`));
    }, 5000);

    socket.on("connect", () => {
      console.log(`[${label}] Connected: ${socket.id}`);

      socket.emit(
        "HELLO",
        createMessage("HELLO", `${label}-hello`, {
          clientId,
          playerId
        })
      );
    });

    socket.on("WELCOME", (msg) => {
      clearTimeout(timeout);
      console.log(`[${label}] WELCOME received`);
      resolve({ socket, welcome: msg });
    });

    socket.on("ERROR", (msg) => {
      console.log(`[${label}] ERROR during connect:`);
      console.log(msg);
    });
  });
}

async function main() {
  const roomName = `room-${Date.now()}`;
  const correctPassword = "test123";
  const wrongPassword = "wrong123";

  let creator;
  let joinerOk;
  let joinerWrongPassword;
  let joinerMissingRoom;

  try {
    // ============================================================
    // STEP 1: Creator connects and creates room
    // ============================================================
    creator = await connectClient({
      clientId: "client-room-creator",
      playerId: "player-room-creator",
      label: "creator"
    });

    const createResult = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for GAME_CREATED"));
      }, 5000);

      creator.socket.once("GAME_CREATED", (msg) => {
        clearTimeout(timeout);
        console.log("\n[creator] GAME_CREATED received:");
        console.log(msg);
        resolve(msg);
      });

      creator.socket.once("ERROR", (msg) => {
        clearTimeout(timeout);
        reject(
          new Error(
            `GAME_CREATE failed: ${msg?.payload?.code} - ${msg?.payload?.message}`
          )
        );
      });

      creator.socket.emit(
        "GAME_CREATE",
        createMessage("GAME_CREATE", "creator-create", {
          roomName,
          roomPassword: correctPassword
        })
      );
    });

    const gameId = createResult.payload.gameId;

    // ============================================================
    // STEP 2: Valid join with correct password
    // ============================================================
    joinerOk = await connectClient({
      clientId: "client-room-joiner-ok",
      playerId: "player-room-joiner-ok",
      label: "joiner-ok"
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for GAME_JOINED"));
      }, 5000);

      joinerOk.socket.once("GAME_JOINED", (msg) => {
        clearTimeout(timeout);
        console.log("\n[joiner-ok] GAME_JOINED received:");
        console.log(msg);
        resolve(msg);
      });

      joinerOk.socket.once("ERROR", (msg) => {
        clearTimeout(timeout);
        reject(
          new Error(
            `Expected successful join, got ERROR: ${msg?.payload?.code} - ${msg?.payload?.message}`
          )
        );
      });

      joinerOk.socket.emit(
        "GAME_JOIN",
        createMessage("GAME_JOIN", "joiner-ok-join", {
          roomName,
          roomPassword: correctPassword
        })
      );
    });

    // ============================================================
    // STEP 3: Wrong password test
    // ============================================================
    joinerWrongPassword = await connectClient({
      clientId: "client-room-joiner-badpass",
      playerId: "player-room-joiner-badpass",
      label: "joiner-badpass"
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for wrong-password ERROR"));
      }, 5000);

      joinerWrongPassword.socket.once("ERROR", (msg) => {
        clearTimeout(timeout);
        console.log("\n[joiner-badpass] ERROR received:");
        console.log(msg);

        const code = msg?.payload?.code;
        if (code !== "INVALID_ROOM_PASSWORD") {
          reject(
            new Error(
              `Expected INVALID_ROOM_PASSWORD, got ${code || "unknown"}`
            )
          );
          return;
        }

        resolve(msg);
      });

      joinerWrongPassword.socket.once("GAME_JOINED", () => {
        clearTimeout(timeout);
        reject(new Error("Expected join failure, but GAME_JOINED was received"));
      });

      joinerWrongPassword.socket.emit(
        "GAME_JOIN",
        createMessage("GAME_JOIN", "joiner-badpass-join", {
          roomName,
          roomPassword: wrongPassword
        })
      );
    });

    // ============================================================
    // STEP 4: Non-existent room test
    // ============================================================
    joinerMissingRoom = await connectClient({
      clientId: "client-room-joiner-missing",
      playerId: "player-room-joiner-missing",
      label: "joiner-missing"
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for missing-room ERROR"));
      }, 5000);

      joinerMissingRoom.socket.once("ERROR", (msg) => {
        clearTimeout(timeout);
        console.log("\n[joiner-missing] ERROR received:");
        console.log(msg);

        const code = msg?.payload?.code;
        if (code !== "ROOM_NOT_FOUND") {
          reject(
            new Error(`Expected ROOM_NOT_FOUND, got ${code || "unknown"}`)
          );
          return;
        }

        resolve(msg);
      });

      joinerMissingRoom.socket.once("GAME_JOINED", () => {
        clearTimeout(timeout);
        reject(new Error("Expected join failure, but GAME_JOINED was received"));
      });

      joinerMissingRoom.socket.emit(
        "GAME_JOIN",
        createMessage("GAME_JOIN", "joiner-missing-join", {
          roomName: "non-existent-room",
          roomPassword: "whatever"
        })
      );
    });

    console.log("\nTest summary:");
    console.log(`- Room created successfully: true`);
    console.log(`- Valid join succeeded: true`);
    console.log(`- Wrong password rejected: true`);
    console.log(`- Missing room rejected: true`);
    console.log(`- Created gameId: ${gameId}`);
    console.log(`- Room name: ${roomName}`);
  } catch (error) {
    console.error("\nTest failed:");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (creator?.socket) creator.socket.disconnect();
    if (joinerOk?.socket) joinerOk.socket.disconnect();
    if (joinerWrongPassword?.socket) joinerWrongPassword.socket.disconnect();
    if (joinerMissingRoom?.socket) joinerMissingRoom.socket.disconnect();
  }
}

main();