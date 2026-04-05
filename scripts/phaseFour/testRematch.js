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
  const roomName = `rematch-room-${Date.now()}`;
  const roomPassword = "rematch123";

  let client1;
  let client2;

  try {
    // ============================================================
    // STEP 1: Connect both players
    // ============================================================
    client1 = await connectAndHello({
      label: "client1",
      clientId: "client-rematch-1",
      playerId: "player-rematch-1"
    });

    client2 = await connectAndHello({
      label: "client2",
      clientId: "client-rematch-2",
      playerId: "player-rematch-2"
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

    // ============================================================
    // STEP 4: Play Fool's Mate to finish game
    // ============================================================

    // 1. f2f3
    const updateAfterF3Client1Promise = waitForEvent(client1.socket, "STATE_UPDATE");
    const updateAfterF3Client2Promise = waitForEvent(client2.socket, "STATE_UPDATE");
    await submitMove({
      socket: client1.socket,
      label: "client1",
      gameId,
      revision: currentRevision,
      uci: "f2f3"
    });
    const [updateAfterF3Client1, updateAfterF3Client2] = await Promise.all([
      updateAfterF3Client1Promise,
      updateAfterF3Client2Promise
    ]);
    currentRevision = updateAfterF3Client1.payload.revision;

    // 1... e7e5
    const updateAfterE5Client1Promise = waitForEvent(client1.socket, "STATE_UPDATE");
    const updateAfterE5Client2Promise = waitForEvent(client2.socket, "STATE_UPDATE");
    await submitMove({
      socket: client2.socket,
      label: "client2",
      gameId,
      revision: currentRevision,
      uci: "e7e5"
    });
    const [updateAfterE5Client1, updateAfterE5Client2] = await Promise.all([
      updateAfterE5Client1Promise,
      updateAfterE5Client2Promise
    ]);
    currentRevision = updateAfterE5Client1.payload.revision;

    // 2. g2g4
    const updateAfterG4Client1Promise = waitForEvent(client1.socket, "STATE_UPDATE");
    const updateAfterG4Client2Promise = waitForEvent(client2.socket, "STATE_UPDATE");
    await submitMove({
      socket: client1.socket,
      label: "client1",
      gameId,
      revision: currentRevision,
      uci: "g2g4"
    });
    const [updateAfterG4Client1, updateAfterG4Client2] = await Promise.all([
      updateAfterG4Client1Promise,
      updateAfterG4Client2Promise
    ]);
    currentRevision = updateAfterG4Client1.payload.revision;

    // 2... d8h4#
    const updateAfterMateClient1Promise = waitForEvent(client1.socket, "STATE_UPDATE");
    const updateAfterMateClient2Promise = waitForEvent(client2.socket, "STATE_UPDATE");
    await submitMove({
      socket: client2.socket,
      label: "client2",
      gameId,
      revision: currentRevision,
      uci: "d8h4"
    });
    const [updateAfterMateClient1, updateAfterMateClient2] = await Promise.all([
      updateAfterMateClient1Promise,
      updateAfterMateClient2Promise
    ]);

    console.log("\n[client1] Final STATE_UPDATE after checkmate:");
    console.log(updateAfterMateClient1);

    console.log("\n[client2] Final STATE_UPDATE after checkmate:");
    console.log(updateAfterMateClient2);

    if (updateAfterMateClient1.payload.state !== "FINISHED") {
      throw new Error("Expected game state FINISHED after checkmate");
    }

    if (updateAfterMateClient1.payload.result !== "BLACK_WIN_CHECKMATE") {
      throw new Error(
        `Expected BLACK_WIN_CHECKMATE, got ${updateAfterMateClient1.payload.result}`
      );
    }

    // ============================================================
    // STEP 5: White requests rematch
    // ============================================================
    const rematchStatusClient1Promise = waitForEvent(client1.socket, "REMATCH_STATUS");
    const rematchStatusClient2Promise = waitForEvent(client2.socket, "REMATCH_STATUS");

    client1.socket.emit(
      "REMATCH_REQUEST",
      createMessage("REMATCH_REQUEST", "client1-rematch", {
        gameId
      })
    );

    const [rematchStatusClient1, rematchStatusClient2] = await Promise.all([
      rematchStatusClient1Promise,
      rematchStatusClient2Promise
    ]);

    console.log("\n[client1] REMATCH_STATUS received:");
    console.log(rematchStatusClient1);

    console.log("\n[client2] REMATCH_STATUS received:");
    console.log(rematchStatusClient2);

    if (!rematchStatusClient1.payload.rematch.white || rematchStatusClient1.payload.rematch.black) {
      throw new Error("Expected only white to have accepted rematch so far");
    }

    // ============================================================
    // STEP 6: Black requests rematch
    // ============================================================
    const rematchStartClient1Promise = waitForEvent(client1.socket, "REMATCH_START");
    const rematchStartClient2Promise = waitForEvent(client2.socket, "REMATCH_START");
    const rematchSyncClient1Promise = waitForEvent(client1.socket, "STATE_SYNC");
    const rematchSyncClient2Promise = waitForEvent(client2.socket, "STATE_SYNC");

    client2.socket.emit(
      "REMATCH_REQUEST",
      createMessage("REMATCH_REQUEST", "client2-rematch", {
        gameId
      })
    );

    const [
      rematchStartClient1,
      rematchStartClient2,
      rematchSyncClient1,
      rematchSyncClient2
    ] = await Promise.all([
      rematchStartClient1Promise,
      rematchStartClient2Promise,
      rematchSyncClient1Promise,
      rematchSyncClient2Promise
    ]);

    console.log("\n[client1] REMATCH_START received:");
    console.log(rematchStartClient1);

    console.log("\n[client2] REMATCH_START received:");
    console.log(rematchStartClient2);

    console.log("\n[client1] STATE_SYNC after rematch:");
    console.log(rematchSyncClient1);

    console.log("\n[client2] STATE_SYNC after rematch:");
    console.log(rematchSyncClient2);

    // ============================================================
    // STEP 7: Validate reset state
    // ============================================================
    const resetState = rematchSyncClient1.payload;

    if (resetState.state !== "IN_PROGRESS") {
      throw new Error(`Expected IN_PROGRESS after rematch, got ${resetState.state}`);
    }

    if (resetState.revision !== 0) {
      throw new Error(`Expected revision 0 after rematch, got ${resetState.revision}`);
    }

    if (resetState.fen !== START_FEN) {
      throw new Error(`Expected starting FEN after rematch, got ${resetState.fen}`);
    }

    if (resetState.turnColour !== "white") {
      throw new Error(`Expected white to move after rematch, got ${resetState.turnColour}`);
    }

    if (resetState.result !== null) {
      throw new Error(`Expected result null after rematch, got ${resetState.result}`);
    }

    if (!Array.isArray(resetState.moveHistory) || resetState.moveHistory.length !== 0) {
      throw new Error("Expected empty moveHistory after rematch");
    }

    if (resetState.rematch?.white || resetState.rematch?.black) {
      throw new Error("Expected rematch flags to reset to false");
    }

    console.log("\nRematch test summary:");
    console.log(`- Initial game finished successfully: true`);
    console.log(`- First rematch request recorded: true`);
    console.log(`- Second rematch request triggered reset: true`);
    console.log(`- Board reset to starting state: true`);
    console.log(`- Game ID preserved across rematch: ${gameId}`);
  } catch (error) {
    console.error("\nRematch test failed:");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (client1?.socket && client1.socket.connected) client1.socket.disconnect();
    if (client2?.socket && client2.socket.connected) client2.socket.disconnect();
  }
}

main();