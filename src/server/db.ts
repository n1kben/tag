import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../data/tag-game.db');

let db: Database.Database;

export function initDB(): void {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      games_played INTEGER DEFAULT 0,
      games_won INTEGER DEFAULT 0,
      total_survival_time_ms INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      player1_name TEXT NOT NULL,
      player2_name TEXT NOT NULL,
      winner_name TEXT,
      duration_ms INTEGER NOT NULL,
      player1_survival_ms INTEGER,
      player2_survival_ms INTEGER,
      ended_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

export function recordMatch(
  roomId: string,
  p1Name: string,
  p2Name: string,
  winnerName: string | null,
  durationMs: number,
  p1SurvivalMs: number,
  p2SurvivalMs: number,
): void {
  const upsertPlayer = db.prepare(`
    INSERT INTO players (name, games_played, games_won, total_survival_time_ms)
    VALUES (?, 1, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      games_played = games_played + 1,
      games_won = games_won + excluded.games_won,
      total_survival_time_ms = total_survival_time_ms + excluded.total_survival_time_ms
  `);

  const insertMatch = db.prepare(`
    INSERT INTO matches (room_id, player1_name, player2_name, winner_name, duration_ms, player1_survival_ms, player2_survival_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    upsertPlayer.run(p1Name, winnerName === p1Name ? 1 : 0, p1SurvivalMs);
    upsertPlayer.run(p2Name, winnerName === p2Name ? 1 : 0, p2SurvivalMs);
    insertMatch.run(roomId, p1Name, p2Name, winnerName, durationMs, p1SurvivalMs, p2SurvivalMs);
  });

  transaction();
}
