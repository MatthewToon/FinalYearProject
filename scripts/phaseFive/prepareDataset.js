// Development validation script for exercising a chess workflow.

const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

const inputFile = path.join("data", "games.csv");
const outputFile = path.join("data", "gamesCleaned.csv");

// We collect accepted rows in memory and write one clean CSV at the end.
const rows = [];

fs.createReadStream(inputFile)
  .pipe(csv())
  .on("data", (row) => {
    const turns = parseInt(row.turns, 10);
    const status = row.victory_status?.trim().toLowerCase();
    const moves = row.moves?.trim();

    // Skip rows that are empty, too short/long, or ended in ways we do not want to benchmark.
    if (!moves) return;
    if (isNaN(turns) || turns < 10 || turns > 120) return;
    if (status === "aborted" || status === "outoftime") return;

    rows.push({
      id: row.id,
      rated: row.rated,
      turns: row.turns,
      victory_status: row.victory_status,
      winner: row.winner,
      white_rating: row.white_rating,
      black_rating: row.black_rating,
      moves: row.moves,
      opening_name: row.opening_name || ""
    });
  })
  .on("end", () => {
    // Rebuild the cleaned file as a plain CSV so other scripts can read it easily.
    const header = [
      "id",
      "rated",
      "turns",
      "victory_status",
      "winner",
      "white_rating",
      "black_rating",
      "moves",
      "opening_name"
    ].join(",");

    const lines = rows.map((row) =>
      [
        row.id,
        row.rated,
        row.turns,
        row.victory_status,
        row.winner,
        row.white_rating,
        row.black_rating,
        `"${row.moves.replace(/"/g, '""')}"`,
        `"${row.opening_name.replace(/"/g, '""')}"`
      ].join(",")
    );

    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, [header, ...lines].join("\n"));
    console.log(`Saved ${rows.length} games to ${outputFile}`);
  });