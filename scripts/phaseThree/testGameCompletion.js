/*
 * Script: testGameCompletion
 *
 * This is a small development/testing script used during the project.
 * Read the code below to see which server event or workflow it exercises.
 */

const { randomUUID } = require("crypto");
const { Chess } = require("../../server/monolith/node_modules/chess.js");

const sessionStore = require("../../server/monolith/src/state/sessionStore");
const moveService = require("../../server/monolith/src/services/moveService");
const { pool } = require("../../server/monolith/src/persistence/db");
const { SESSION_STATES } = require("../../server/monolith/src/config/constants");

function getTurnColourFromFen(fen) {
  const chess = new Chess(fen);
  return chess.turn() === "w" ? "white" : "black";
}

function buildSession({ fen, whitePlayerId = "player-1", blackPlayerId = "player-2" }) {
  return {
    gameId: randomUUID(),
    state: SESSION_STATES.IN_PROGRESS,
    revision: 0,
    fen,
    initialFen: fen,
    turnColour: getTurnColourFromFen(fen),
    result: null,
    players: {
      white: {
        clientId: "client-1",
        playerId: whitePlayerId,
        socketId: null,
        connected: false
      },
      black: {
        clientId: "client-2",
        playerId: blackPlayerId,
        socketId: null,
        connected: false
      }
    },
    moveHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function deleteGame(gameId) {
  await pool.query("DELETE FROM games WHERE game_id = $1", [gameId]);
}

async function runScenario({ name, fen, moves, expectedState, expectedResult }) {
  console.log(`\n=== ${name} ===`);

  const session = buildSession({ fen });
  await sessionStore.createSession(session);

  let currentRevision = 0;
  let finalResult = null;

  for (const move of moves) {
    const result = await moveService.applyMove({
      gameId: session.gameId,
      playerId: move.playerId,
      expectedRevision: currentRevision,
      uci: move.uci
    });

    if (!result.ok) {
      throw new Error(
        `${name} failed on move ${move.uci}: ${result.error.code} - ${result.error.message}`
      );
    }

    finalResult = result;
    currentRevision = result.session.revision;
  }

  if (!finalResult) {
    throw new Error(`${name} produced no final result`);
  }

  const finalSession = finalResult.session;

  console.log("Final state:", finalSession.state);
  console.log("Final result:", finalSession.result);
  console.log("Final revision:", finalSession.revision);
  console.log("Final FEN:", finalSession.fen);

  if (finalSession.state !== expectedState) {
    throw new Error(
      `${name} expected state ${expectedState}, got ${finalSession.state}`
    );
  }

  if (finalSession.result !== expectedResult) {
    throw new Error(
      `${name} expected result ${expectedResult}, got ${finalSession.result}`
    );
  }

  console.log(`${name} passed`);

  await deleteGame(session.gameId);
}

async function main() {
  try {
    // 1. Checkmate: Fool's Mate
    await runScenario({
      name: "Checkmate",
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      moves: [
        { playerId: "player-1", uci: "f2f3" },
        { playerId: "player-2", uci: "e7e5" },
        { playerId: "player-1", uci: "g2g4" },
        { playerId: "player-2", uci: "d8h4" }
      ],
      expectedState: SESSION_STATES.FINISHED,
      expectedResult: "BLACK_WIN_CHECKMATE"
    });

    // 2. Stalemate
    // Initial: black king a8, white king c6, white queen d7, white to move
    // Move Qc7 creates stalemate
    await runScenario({
        name: "Stalemate",
        fen: "k7/3Q4/2K5/8/8/8/8/8 w - - 0 1",
        moves: [
         { playerId: "player-1", uci: "d7c7" }
        ],
        expectedState: SESSION_STATES.FINISHED,
        expectedResult: "DRAW_STALEMATE"
    });

    // 3. Insufficient material
    // K+N vs K remains insufficient after any legal knight move
    await runScenario({
      name: "Insufficient Material",
      fen: "7k/8/8/8/8/8/6N1/4K3 w - - 0 1",
      moves: [
        { playerId: "player-1", uci: "g2h4" }
      ],
      expectedState: SESSION_STATES.FINISHED,
      expectedResult: "DRAW_INSUFFICIENT_MATERIAL"
    });

    // 4. Threefold repetition
    // Position repeats for the third time after 8 plies
    await runScenario({
      name: "Threefold Repetition",
      fen: "4k1n1/8/8/8/8/8/8/4K1N1 w - - 0 1",
      moves: [
        { playerId: "player-1", uci: "g1f3" },
        { playerId: "player-2", uci: "g8f6" },
        { playerId: "player-1", uci: "f3g1" },
        { playerId: "player-2", uci: "f6g8" },
        { playerId: "player-1", uci: "g1f3" },
        { playerId: "player-2", uci: "g8f6" },
        { playerId: "player-1", uci: "f3g1" },
        { playerId: "player-2", uci: "f6g8" }
      ],
      expectedState: SESSION_STATES.FINISHED,
      expectedResult: "DRAW_THREEFOLD_REPETITION"
    });

    // 5. Generic draw via fifty-move rule
    // Halfmove clock is 99, then a quiet rook move triggers draw
    await runScenario({
      name: "Fifty-Move Rule",
      fen: "7k/8/8/8/8/8/8/4K2R w - - 99 1",
      moves: [
        { playerId: "player-1", uci: "h1g1" }
      ],
      expectedState: SESSION_STATES.FINISHED,
      expectedResult: "DRAW"
    });

    console.log("\nAll game-completion scenarios passed");
  } catch (error) {
    console.error("\nTest failed:");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
