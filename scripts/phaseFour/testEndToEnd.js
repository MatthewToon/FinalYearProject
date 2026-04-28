// Script: testEndToEnd
// This is a small development/testing script used during the project.
// Read the code below to see which server event or workflow it exercises.

const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:3001";

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

    socket.on("WELCOME", (msg) => {
      clearTimeout(timeout);
      console.log(`[${label}] WELCOME received`);
      resolve({ socket, welcome: msg });
    });

    socket.on("ERROR", (msg) => {
      console.log(`[${label}] ERROR received:`);
      console.log(msg);
    });
  });
}

async function main() {
  const roomName = `e2e-room-${Date.now()}`;
  const roomPassword = "endtoend123";

  let client1;
  let client2;
  let reconnectClient1;

  try {
    // STEP 1: Connect both players
    client1 = await connectAndHello({
      label: "client1",
      clientId: "client-e2e-1",
      playerId: "player-e2e-1"
    });

    client2 = await connectAndHello({
      label: "client2",
      clientId: "client-e2e-2",
      playerId: "player-e2e-2"
    });

    // STEP 2: Create room
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

    // STEP 3: Join room
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

    // STEP 4: Play a few moves

    // Move 1: e2e4
    const moveAcceptedE4Promise = waitForEvent(client1.socket, "MOVE_ACCEPTED");
    const updateAfterE4Client1Promise = waitForEvent(client1.socket, "STATE_UPDATE");
    const updateAfterE4Client2Promise = waitForEvent(client2.socket, "STATE_UPDATE");

    client1.socket.emit(
      "MOVE_SUBMIT",
      createMessage("MOVE_SUBMIT", `client1-move-e2e4-${currentRevision}`, {
        gameId,
        expectedRevision: currentRevision,
        uci: "e2e4"
      })
    );

    const moveAcceptedE4 = await moveAcceptedE4Promise;
    const [updateAfterE4Client1, updateAfterE4Client2] = await Promise.all([
      updateAfterE4Client1Promise,
      updateAfterE4Client2Promise
    ]);

    console.log("\n[client1] MOVE_ACCEPTED received:");
    console.log(moveAcceptedE4);

    console.log("\n[client1] STATE_UPDATE after e2e4:");
    console.log(updateAfterE4Client1);

    console.log("\n[client2] STATE_UPDATE after e2e4:");
    console.log(updateAfterE4Client2);

    currentRevision = updateAfterE4Client1.payload.revision;

    // Move 2: e7e5
    const moveAcceptedE5Promise = waitForEvent(client2.socket, "MOVE_ACCEPTED");
    const updateAfterE5Client1Promise = waitForEvent(client1.socket, "STATE_UPDATE");
    const updateAfterE5Client2Promise = waitForEvent(client2.socket, "STATE_UPDATE");

    client2.socket.emit(
      "MOVE_SUBMIT",
      createMessage("MOVE_SUBMIT", `client2-move-e7e5-${currentRevision}`, {
        gameId,
        expectedRevision: currentRevision,
        uci: "e7e5"
      })
    );

    const moveAcceptedE5 = await moveAcceptedE5Promise;
    const [updateAfterE5Client1, updateAfterE5Client2] = await Promise.all([
      updateAfterE5Client1Promise,
      updateAfterE5Client2Promise
    ]);

    console.log("\n[client2] MOVE_ACCEPTED received:");
    console.log(moveAcceptedE5);

    console.log("\n[client1] STATE_UPDATE after e7e5:");
    console.log(updateAfterE5Client1);

    console.log("\n[client2] STATE_UPDATE after e7e5:");
    console.log(updateAfterE5Client2);

    currentRevision = updateAfterE5Client1.payload.revision;

    // STEP 5: Disconnect client1
    console.log("\n--- Disconnecting client1 ---\n");
    client1.socket.disconnect();

    // STEP 6: Resume client1
    reconnectClient1 = await connectAndHello({
      label: "client1-resume",
      clientId: "client-e2e-1",
      playerId: "player-e2e-1"
    });

    const resumedPromise = waitForEvent(reconnectClient1.socket, "GAME_RESUMED");
    const resumedSyncPromise = waitForEvent(reconnectClient1.socket, "STATE_SYNC");
    const reconnectedNoticePromise = waitForEvent(
      client2.socket,
      "PLAYER_RECONNECTED",
      2000
    ).catch(() => null);

    reconnectClient1.socket.emit(
      "GAME_RESUME",
      createMessage("GAME_RESUME", "client1-resume-game", {
        gameId
      })
    );

    const [resumed, resumedSync, reconnectedNotice] = await Promise.all([
      resumedPromise,
      resumedSyncPromise,
      reconnectedNoticePromise
    ]);

    console.log("\n[client1-resume] GAME_RESUMED received:");
    console.log(resumed);

    console.log("\n[client1-resume] STATE_SYNC received:");
    console.log(resumedSync);

    if (reconnectedNotice) {
      console.log("\n[client2] PLAYER_RECONNECTED received:");
      console.log(reconnectedNotice);
    } else {
      console.log("\n[client2] No PLAYER_RECONNECTED received within timeout");
    }

    currentRevision = resumedSync.payload.revision;

    // STEP 7: Continue playing after resume
    const moveAcceptedNf3Promise = waitForEvent(
      reconnectClient1.socket,
      "MOVE_ACCEPTED"
    );
    const updateAfterNf3Client1Promise = waitForEvent(
      reconnectClient1.socket,
      "STATE_UPDATE"
    );
    const updateAfterNf3Client2Promise = waitForEvent(
      client2.socket,
      "STATE_UPDATE"
    );

    reconnectClient1.socket.emit(
      "MOVE_SUBMIT",
      createMessage("MOVE_SUBMIT", `client1-resume-move-g1f3-${currentRevision}`, {
        gameId,
        expectedRevision: currentRevision,
        uci: "g1f3"
      })
    );

    const moveAcceptedNf3 = await moveAcceptedNf3Promise;
    const [updateAfterNf3Client1, updateAfterNf3Client2] = await Promise.all([
      updateAfterNf3Client1Promise,
      updateAfterNf3Client2Promise
    ]);

    console.log("\n[client1-resume] MOVE_ACCEPTED received:");
    console.log(moveAcceptedNf3);

    console.log("\n[client1-resume] STATE_UPDATE after g1f3:");
    console.log(updateAfterNf3Client1);

    console.log("\n[client2] STATE_UPDATE after g1f3:");
    console.log(updateAfterNf3Client2);

    currentRevision = updateAfterNf3Client1.payload.revision;

    console.log("\nEnd-to-end summary:");
    console.log(`- Room created: ${roomName}`);
    console.log(`- Game joined successfully: true`);
    console.log(`- Resume successful: true`);
    console.log(`- Final revision observed: ${currentRevision}`);
    console.log(`- Final gameId: ${gameId}`);
  } catch (error) {
    console.error("\nEnd-to-end test failed:");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (client1?.socket && client1.socket.connected) client1.socket.disconnect();
    if (client2?.socket && client2.socket.connected) client2.socket.disconnect();
    if (reconnectClient1?.socket && reconnectClient1.socket.connected) {
      reconnectClient1.socket.disconnect();
    }
  }
}

main();