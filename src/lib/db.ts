/**
 * @module db
 * SQLite database singleton via better-sqlite3.
 * Creates tables on first access. All server-side data goes here.
 */
import Database from "better-sqlite3";
import { join } from "path";
import { mkdirSync } from "fs";
import { logger } from "@/lib/logger";

const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "voicezettel.db");

let _db: Database.Database | null = null;

/**
 * Get or create the singleton SQLite database connection.
 * Tables are created lazily on first call.
 */
export function getDb(): Database.Database {
    if (_db) return _db;

    mkdirSync(DATA_DIR, { recursive: true });
    _db = new Database(DB_PATH);

    // WAL mode for better concurrent read performance
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");

    // ── Create tables ──
    _db.exec(`
        CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            text TEXT NOT NULL,
            tags TEXT NOT NULL DEFAULT '[]',
            embedding BLOB,
            created_at TEXT NOT NULL,
            UNIQUE(user_id, id)
        );

        CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
        CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(user_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            source TEXT,
            metadata TEXT,
            timestamp TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_chat_user ON chat_messages(user_id, timestamp DESC);

        CREATE TABLE IF NOT EXISTS token_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            model TEXT NOT NULL,
            text_in INTEGER NOT NULL DEFAULT 0,
            text_out INTEGER NOT NULL DEFAULT 0,
            audio_in INTEGER NOT NULL DEFAULT 0,
            audio_out INTEGER NOT NULL DEFAULT 0,
            cost_usd REAL NOT NULL DEFAULT 0,
            timestamp TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_tokens_user ON token_usage(user_id);

        CREATE TABLE IF NOT EXISTS settings (
            user_id TEXT PRIMARY KEY,
            data TEXT NOT NULL DEFAULT '{}'
        );
    `);

    logger.info("[DB] SQLite initialized at " + DB_PATH);
    return _db;
}
