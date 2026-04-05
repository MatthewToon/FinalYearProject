const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:3001";
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function createMessage(type, clientMsgId, payload) {
  return {
    type,
    clientMsgId,
    payload
  };
}

function waitForEvent(socket, eventName, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);

    socket.once(eventName, (msg) => {
      clearTimeout(timeout);
      resolve(msg);
    });
  });
}

function connectAndHello({ label, clientId, playerId }) {
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

    socket.on("WELCOME", () => {
      clearTimeout(timeout);
      console.log(`[${label}] WELCOME received`);
      resolve({ socket });
    });

    socket.on("ERROR", (msg) => {
      console.log(`[${label}] ERROR received:`);
      console.log(msg);
    });
  });
}

async function submitMove({ socket, label, gameId, revision, uci }) {
  const acceptedPromise = waitForEvent(socket, "MOVE_ACCEPTED");

  socket.emit(
    "MOVE_SUBMIT",
    createMessage("MOVE_SUBMIT", `${label}-move-${uci}-${revision}`, {
      gameId,
      expectedRevision: revision,
      uci
    })
  );

  const accepted = await acceptedPromise;
  console.log(`\n[${label}] MOVE_ACCEPTED received:`);
  console.log(accepted);

  return accepted;
}

async function main() {
  const roomName = `resign-room-${Date.now()}`;
  const roomPassword = "resign123";

  let client1;
  let client2;

  try {
    // ============================================================
    // STEP 1: Connect both players
    // ============================================================
    client1 = await connectAndHello({
      label: "client1",
      clientId: "client-resign-1",
      playerId: "player-resign-1"
    });

    client2 = await connectAndHello({
      label: "client2",
      clientId: "client-resign-2",
      playerId: "player-resign-2"
    });

    // ============================================================
    // STEP 2: Create room
    // ============================================================
    const gameCreatedPromise = waitForEvent(client1.socket, "GAME_CREATED");
    const stateSyncCreatedPromise = waitForEvent(client1.socket, "STATE_SYNC");

    client1.socket.emit(
      "GAME_CREATE",
      createMessage("GAME_CREATE", "client1-create", {
        roomName,
        roomPassword
      })
    );

    const [gameCreated, stateSyncCreated] = await Promise.all([
      gameCreatedPromise,
      stateSyncCreatedPromise
    ]);

    console.log("\n[client1] GAME_CREATED received:");
    console.log(gameCreated);

    console.log("\n[client1] STATE_SYNC received:");
    console.log(stateSyncCreated);

    const gameId = gameCreated.payload.gameId;

    // ============================================================
    // STEP 3: Join room
    // ============================================================
    const gameJoinedPromise = waitForEvent(client2.socket, "GAME_JOINED");
    const gameStartClient1Promise = waitForEvent(client1.socket, "GAME_START");
    const gameStartClient2Promise = waitForEvent(client2.socket, "GAME_START");
    const syncClient1Promise = waitForEvent(client1.socket, "STATE_SYNC");
    const syncClient2Promise = waitForEvent(client2.socket, "STATE_SYNC");

    client2.socket.emit(
      "GAME_JOIN",
      createMessage("GAME_JOIN", "client2-join", {
        roomName,
        roomPassword
      })
    );

    const [
      gameJoined,
      gameStartClient1,
      gameStartClient2,
      syncClient1,
      syncClient2
    ] = await Promise.all([
      gameJoinedPromise,
      gameStartClient1Promise,
      gameStartClient2Promise,
      syncClient1Promise,
      syncClient2Promise
    ]);

    console.log("\n[client2] GAME_JOINED received:");
    console.log(gameJoined);

    console.log("\n[client1] GAME_START received:");
    console.log(gameStartClient1);

    console.log("\n[client2] GAME_START received:");
    console.log(gameStartClient2);

    console.log("\n[client1] STATE_SYNC after join:");
    console.log(syncClient1);

    console.log("\n[client2] STATE_SYNC after join:");
    console.log(syncClient2);

    let currentRevision = syncClient1.payload.revision;

    if (syncClient1.payload.state !== "IN_PROGRESS") {
      throw new Error(`Expected IN_PROGRESS after join, got ${syncClient1.payload.state}`);
    }

    if (syncClient1.payload.fen !== START_FEN) {
      throw new Error(`Expected starting FEN after join, got ${syncClient1.payload.fen}`);
    }

    // ============================================================
    // STEP 4: Play one opening move so the game is clearly active
    // ============================================================
    const updateAfterE4Client1Promise = waitForEvent(client1.socket, "STATE_UPDATE");
    const updateAfterE4Client2Promise = waitForEvent(client2.socket, "STATE_UPDATE");

    await submitMove({
      socket: client1.socket,
      label: "client1",
      gameId,
      revision: currentRevision,
      uci: "e2e4"
    });

    const [updateAfterE4Client1, updateAfterE4Client2] = await Promise.all([
      updateAfterE4Client1Promise,
      updateAfterE4Client2Promise
    ]);

    console.log("\n[client1] STATE_UPDATE after e2e4:");
    console.log(updateAfterE4Client1);

    console.log("\n[client2] STATE_UPDATE after e2e4:");
    console.log(updateAfterE4Client2);

    currentRevision = updateAfterE4Client1.payload.revision;

    // ============================================================
    // STEP 5: Black resigns
    // ============================================================
    const concludedClient1Promise = waitForEvent(client1.socket, "GAME_CONCLUDED");
    const concludedClient2Promise = waitForEvent(client2.socket, "GAME_CONCLUDED");
    const resignSyncClient1Promise = waitForEvent(client1.socket, "STATE_SYNC");
    const resignSyncClient2Promise = waitForEvent(client2.socket, "STATE_SYNC");

    client2.socket.emit(
      "RESIGN",
      createMessage("RESIGN", "client2-resign", {
        gameId
      })
    );

    const [
      concludedClient1,
      concludedClient2,
      resignSyncClient1,
      resignSyncClient2
    ] = await Promise.all([
      concludedClient1Promise,
      concludedClient2Promise,
      resignSyncClient1Promise,
      resignSyncClient2Promise
    ]);

    console.log("\n[client1] GAME_CONCLUDED received:");
    console.log(concludedClient1);

    console.log("\n[client2] GAME_CONCLUDED received:");
    console.log(concludedClient2);

    console.log("\n[client1] STATE_SYNC after resignation:");
    console.log(resignSyncClient1);

    console.log("\n[client2] STATE_SYNC after resignation:");
    console.log(resignSyncClient2);

    const finalState = resignSyncClient1.payload;

    if (finalState.state !== "FINISHED") {
      throw new Error(`Expected FINISHED after resignation, got ${finalState.state}`);
    }

    if (finalState.result !== "WHITE_WIN_RESIGNATION") {
      throw new Error(
        `Expected WHITE_WIN_RESIGNATION after black resignation, got ${finalState.result}`
      );
    }

    if (finalState.turnColour !== null) {
      throw new Error(`Expected turnColour null after resignation, got ${finalState.turnColour}`);
    }

    if (finalState.revision !== currentRevision) {
      throw new Error(
        `Expected revision to remain ${currentRevision} after resignation, got ${finalState.revision}`
      );
    }

    // ============================================================
    // STEP 6: Verify further move submission is rejected
    // ============================================================
    const rejectedPromise = waitForEvent(client1.socket, "ERROR");

    client1.socket.emit(
      "MOVE_SUBMIT",
      createMessage("MOVE_SUBMIT", "client1-illegal-post-resign-move", {
        gameId,
        expectedRevision: currentRevision,
        uci: "g1f3"
      })
    );

    const rejected = await rejectedPromise;

    console.log("\n[client1] ERROR after post-resignation move attempt:");
    console.log(rejected);

    if (rejected.payload?.code !== "INVALID_GAME_STATE") {
      throw new Error(
        `Expected INVALID_GAME_STATE after move post-resignation, got ${rejected.payload?.code}`
      );
    }

    console.log("\nResign test summary:");
    console.log(`- Game entered IN_PROGRESS successfully: true`);
    console.log(`- Black resignation processed successfully: true`);
    console.log(`- Final state FINISHED confirmed: true`);
    console.log(`- Result recorded as WHITE_WIN_RESIGNATION: true`);
    console.log(`- Post-resignation MOVE_SUBMIT rejected: true`);
    console.log(`- Game ID preserved: ${gameId}`);
  } catch (error) {
    console.error("\nResign test failed:");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (client1?.socket && client1.socket.connected) client1.socket.disconnect();
    if (client2?.socket && client2.socket.connected) client2.socket.disconnect();
  }
}

main();