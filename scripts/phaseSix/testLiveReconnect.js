const { io } = require("socket.io-client");
const SERVER_URL = process.env.SERVER_URL || "http://localhost:3001";

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
      resolve({ socket });
    });

    socket.on("ERROR", () => {});
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

  return accepted;
}

async function main() {
  const roomName = `decomp-live-reconnect-${Date.now()}`;
  const roomPassword = "reconnect123";

  let client1;
  let client2;
  let reconnectClient;

  try {
    client1 = await connectAndHello({
      label: "client1",
      clientId: "decomp-client-1",
      playerId: "decomp-player-1"
    });

    client2 = await connectAndHello({
      label: "client2",
      clientId: "decomp-client-2",
      playerId: "decomp-player-2"
    });

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

    const gameId = gameCreated.payload.gameId;

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

    let currentRevision = syncClient1.payload.revision;

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

    currentRevision = updateAfterE4Client1.payload.revision;

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

    const updateAfterNf3Client1Promise = waitForEvent(client1.socket, "STATE_UPDATE");
    const updateAfterNf3Client2Promise = waitForEvent(client2.socket, "STATE_UPDATE");

    await submitMove({
      socket: client1.socket,
      label: "client1",
      gameId,
      revision: currentRevision,
      uci: "g1f3"
    });

    const [updateAfterNf3Client1, updateAfterNf3Client2] = await Promise.all([
      updateAfterNf3Client1Promise,
      updateAfterNf3Client2Promise
    ]);

    currentRevision = updateAfterNf3Client1.payload.revision;

    client1.socket.disconnect();

    reconnectClient = await connectAndHello({
      label: "client1-reconnect",
      clientId: "decomp-client-1",
      playerId: "decomp-player-1"
    });

    const resumedPromise = waitForEvent(reconnectClient.socket, "GAME_RESUMED");
    const resumedSyncPromise = waitForEvent(reconnectClient.socket, "STATE_SYNC");
    const reconnectedNoticePromise = waitForEvent(
      client2.socket,
      "PLAYER_RECONNECTED",
      2000
    ).catch(() => null);

    reconnectClient.socket.emit(
      "GAME_RESUME",
      createMessage("GAME_RESUME", "client1-resume", {
        gameId
      })
    );

    const [resumed, resumedSync, reconnectedNotice] = await Promise.all([
      resumedPromise,
      resumedSyncPromise,
      reconnectedNoticePromise
    ]);

    if (resumedSync.payload.revision !== currentRevision) {
      throw new Error(
        `Expected resumed revision ${currentRevision}, got ${resumedSync.payload.revision}`
      );
    }

    if (!Array.isArray(resumedSync.payload.moveHistory) || resumedSync.payload.moveHistory.length !== 3) {
      throw new Error(
        `Expected moveHistory length 3 after resume, got ${resumedSync.payload.moveHistory?.length}`
      );
    }

    if (reconnectedNotice) {
    } else {
      throw new Error("Expected PLAYER_RECONNECTED notification for remaining player");
    }

    const updateAfterNc6Client1Promise = waitForEvent(reconnectClient.socket, "STATE_UPDATE");
    const updateAfterNc6Client2Promise = waitForEvent(client2.socket, "STATE_UPDATE");

    await submitMove({
      socket: client2.socket,
      label: "client2",
      gameId,
      revision: currentRevision,
      uci: "b8c6"
    });

    const [updateAfterNc6Client1, updateAfterNc6Client2] = await Promise.all([
      updateAfterNc6Client1Promise,
      updateAfterNc6Client2Promise
    ]);

    currentRevision = updateAfterNc6Client1.payload.revision;

    const updateAfterBc4Client1Promise = waitForEvent(reconnectClient.socket, "STATE_UPDATE");
    const updateAfterBc4Client2Promise = waitForEvent(client2.socket, "STATE_UPDATE");

    await submitMove({
      socket: reconnectClient.socket,
      label: "client1-reconnect",
      gameId,
      revision: currentRevision,
      uci: "f1c4"
    });

    const [updateAfterBc4Client1, updateAfterBc4Client2] = await Promise.all([
      updateAfterBc4Client1Promise,
      updateAfterBc4Client2Promise
    ]);

    currentRevision = updateAfterBc4Client1.payload.revision;

    console.log("\nDecomposed reconnect test summary:");
    console.log("- Game started successfully: true");
    console.log("- Three opening moves completed before disconnect: true");
    console.log("- Resume preserved revision and move history: true");
    console.log("- Opponent received PLAYER_RECONNECTED: true");
    console.log("- Play continued successfully after reconnect: true");
    console.log(`- Final revision observed: ${currentRevision}`);
    console.log(`- Final gameId: ${gameId}`);
  } catch (error) {
    console.error("\nDecomposed reconnect test failed:");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (client1?.socket && client1.socket.connected) client1.socket.disconnect();
    if (client2?.socket && client2.socket.connected) client2.socket.disconnect();
    if (reconnectClient?.socket && reconnectClient.socket.connected) {
      reconnectClient.socket.disconnect();
    }
  }
}

main();
