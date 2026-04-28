// Development validation script for exercising a chess workflow.

const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const { Chess } = require("chess.js");

const inputFile = path.join("data", "gamesCleaned.csv");
const outputFile = path.join("data", "gamesReplay.json");
const replaySampleSize = 1000;
const replayGames = [];

function shuffleArray(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[randomIndex]] = [items[randomIndex], items[index]];
  }
}

function sanListToReplayGame(movesText) {
  const chess = new Chess();
  const sanMoves = movesText
    .trim()
    .split(/\s+/)
    .filter((token) => token && !/^\d+\./.test(token) && token !== "1-0" && token !== "0-1" && token !== "1/2-1/2");

  const uciMoves = [];

  for (const san of sanMoves) {
    const applied = chess.move(san, { sloppy: true });

    if (!applied) {
      return null;
    }

    uciMoves.push(applied.from + applied.to + (applied.promotion || ""));
  }

  if (!chess.isGameOver()) {
    return null;
  }

  return {
    moves: uciMoves,
    finalFen: chess.fen(),
    terminalReason:
      chess.isCheckmate() ? "checkmate" :
      chess.isStalemate() ? "stalemate" :
      chess.isDraw() ? "draw" :
      "game_over"
  };
}

fs.createReadStream(inputFile)
  .pipe(csv())
  .on("data", (row) => {
    const replayGame = sanListToReplayGame(row.moves || "");

    if (!replayGame || replayGame.moves.length === 0) {
      return;
    }

    replayGames.push({
      id: row.id,
      turns: Number.parseInt(row.turns, 10),
      winner: row.winner || "",
      victory_status: row.victory_status || "",
      opening_name: row.opening_name || "",
      roomName: `room-${row.id}`,
      roomPassword: `pass-${row.id}`,
      finalFen: replayGame.finalFen,
      terminalReason: replayGame.terminalReason,
      moves: replayGame.moves
    });
  })
  .on("end", () => {
    shuffleArray(replayGames);
    const sampledReplayGames = replayGames.slice(0, replaySampleSize);

    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, JSON.stringify(sampledReplayGames, null, 2));
    console.log(
      `Saved ${sampledReplayGames.length} randomly selected replay-ready games to ${outputFile}`
    );
  });