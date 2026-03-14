/**
 * Migration script: JSON files → SQLite.
 *
 * Usage: npx tsx scripts/migrate-json-to-sqlite.ts
 *
 * Reads existing JSON data files from data/ directory
 * and inserts them into the SQLite database.
 */
import Database from "better-sqlite3";
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";

const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "voicezettel.db");

async function migrate() {
    mkdirSync(DATA_DIR, { recursive: true });
    const db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");

    // Create tables
    db.exec(`
        CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            text TEXT NOT NULL,
            tags TEXT NOT NULL DEFAULT '[]',
            embedding BLOB,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            source TEXT,
            metadata TEXT,
            timestamp TEXT NOT NULL
        );
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
        CREATE TABLE IF NOT EXISTS settings (
            user_id TEXT PRIMARY KEY,
            data TEXT NOT NULL DEFAULT '{}'
        );
    `);

    // Migrate memory files
    const files = existsSync(DATA_DIR) ? await readdir(DATA_DIR) : [];

    for (const file of files) {
        if (file.startsWith("memory_") && file.endsWith(".json")) {
            const userId = file.replace("memory_", "").replace(".json", "");
            console.log(`[Memory] Migrating ${file}...`);
            try {
                const raw = await readFile(join(DATA_DIR, file), "utf-8");
                const data = JSON.parse(raw) as {
                    memories: Array<{
                        id: string;
                        text: string;
                        tags: string[];
                        createdAt: string;
                        embedding: number[];
                    }>;
                };

                const insert = db.prepare(
                    `INSERT OR IGNORE INTO memories (id, user_id, text, tags, embedding, created_at)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                );
                const tx = db.transaction(() => {
                    for (const mem of data.memories) {
                        const embBuf = Buffer.from(new Float64Array(mem.embedding).buffer);
                        insert.run(mem.id, userId, mem.text, JSON.stringify(mem.tags), embBuf, mem.createdAt);
                    }
                });
                tx();
                console.log(`  → ${data.memories.length} memories migrated`);
            } catch (err) {
                console.error(`  ✗ Failed:`, (err as Error).message);
            }
        }

        if (file.startsWith("chat_") && file.endsWith(".json")) {
            const userId = file.replace("chat_", "").replace(".json", "");
            console.log(`[Chat] Migrating ${file}...`);
            try {
                const raw = await readFile(join(DATA_DIR, file), "utf-8");
                const messages = JSON.parse(raw) as Array<{
                    id: string;
                    role: string;
                    content: string;
                    timestamp: string;
                    source?: string;
                }>;

                const insert = db.prepare(
                    `INSERT OR IGNORE INTO chat_messages (id, user_id, role, content, source, timestamp)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                );
                const tx = db.transaction(() => {
                    for (const m of messages) {
                        insert.run(m.id, userId, m.role, m.content, m.source ?? null, m.timestamp);
                    }
                });
                tx();
                console.log(`  → ${messages.length} messages migrated`);
            } catch (err) {
                console.error(`  ✗ Failed:`, (err as Error).message);
            }
        }

        if (file.startsWith("tokens_") && file.endsWith(".json")) {
            const userId = file.replace("tokens_", "").replace(".json", "");
            console.log(`[Tokens] Migrating ${file}...`);
            try {
                const raw = await readFile(join(DATA_DIR, file), "utf-8");
                const data = JSON.parse(raw) as {
                    entries: Array<{
                        model: string;
                        textIn: number;
                        textOut: number;
                        audioIn: number;
                        audioOut: number;
                        costUsd: number;
                        timestamp: string;
                    }>;
                };

                const insert = db.prepare(
                    `INSERT INTO token_usage (user_id, model, text_in, text_out, audio_in, audio_out, cost_usd, timestamp)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                );
                const tx = db.transaction(() => {
                    for (const e of data.entries) {
                        insert.run(userId, e.model, e.textIn, e.textOut, e.audioIn, e.audioOut, e.costUsd, e.timestamp);
                    }
                });
                tx();
                console.log(`  → ${data.entries.length} entries migrated`);
            } catch (err) {
                console.error(`  ✗ Failed:`, (err as Error).message);
            }
        }
    }

    // Migrate settings
    const settingsDir = join(DATA_DIR, "settings");
    if (existsSync(settingsDir)) {
        const settingsFiles = await readdir(settingsDir);
        for (const file of settingsFiles) {
            if (!file.endsWith(".json")) continue;
            const userId = file.replace(".json", "");
            console.log(`[Settings] Migrating ${file}...`);
            try {
                const raw = await readFile(join(settingsDir, file), "utf-8");
                db.prepare(
                    `INSERT OR REPLACE INTO settings (user_id, data) VALUES (?, ?)`,
                ).run(userId, raw);
                console.log(`  → migrated`);
            } catch (err) {
                console.error(`  ✗ Failed:`, (err as Error).message);
            }
        }
    }

    db.close();
    console.log("\n✅ Migration complete! Database at:", DB_PATH);
}

migrate().catch(console.error);
