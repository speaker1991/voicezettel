/**
 * @module memoryStore
 * Long-term memory storage backed by SQLite.
 * Embeddings stored as Float64Array BLOBs for cosine similarity search.
 */
import { getDb } from "@/lib/db";
import { generateEmbedding, cosineSimilarity } from "@/lib/embeddings";
import { logger } from "@/lib/logger";
import type { Memory, MemorySearchResult } from "@/types/memory";

const SEARCH_TOP_K = 5;
const SEARCH_THRESHOLD = 0.3;

/* ── Helpers ── */

function embeddingToBuffer(embedding: number[]): Buffer {
    return Buffer.from(new Float64Array(embedding).buffer);
}

function bufferToEmbedding(buf: Buffer): number[] {
    return Array.from(new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8));
}

interface MemoryRow {
    id: string;
    user_id: string;
    text: string;
    tags: string;
    embedding: Buffer | null;
    created_at: string;
}

function rowToMemory(row: MemoryRow): Memory {
    return {
        id: row.id,
        text: row.text,
        tags: JSON.parse(row.tags) as string[],
        createdAt: row.created_at,
        embedding: row.embedding ? bufferToEmbedding(row.embedding) : [],
    };
}

/* ── Public API ── */

/**
 * Save a new memory with auto-generated embedding.
 */
export async function saveMemory(
    userId: string,
    text: string,
    tags: string[] = [],
): Promise<Memory> {
    const embedding = await generateEmbedding(text);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    const db = getDb();
    db.prepare(
        `INSERT INTO memories (id, user_id, text, tags, embedding, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, userId, text, JSON.stringify(tags), embeddingToBuffer(embedding), createdAt);

    logger.debug(`Memory [${userId}]: saved "${text.slice(0, 50)}..." [${tags.join(", ")}]`);

    return { id, text, tags, createdAt, embedding };
}

/**
 * Search memories by cosine similarity.
 */
export async function searchMemories(
    userId: string,
    query: string,
): Promise<MemorySearchResult[]> {
    const queryEmbedding = await generateEmbedding(query);
    const isZero = queryEmbedding.every((v) => v === 0);
    if (isZero) return [];

    const db = getDb();
    const rows = db.prepare(
        `SELECT id, user_id, text, tags, embedding, created_at
         FROM memories WHERE user_id = ?`,
    ).all(userId) as MemoryRow[];

    const results: MemorySearchResult[] = [];

    for (const row of rows) {
        if (!row.embedding) continue;
        const embedding = bufferToEmbedding(row.embedding);
        const score = cosineSimilarity(queryEmbedding, embedding);
        if (score >= SEARCH_THRESHOLD) {
            results.push({ memory: rowToMemory(row), score });
        }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, SEARCH_TOP_K);
}

/**
 * Get the most recent N memories for a user.
 */
export async function getRecentMemories(
    userId: string,
    n: number = 20,
): Promise<Memory[]> {
    const db = getDb();
    const rows = db.prepare(
        `SELECT id, user_id, text, tags, embedding, created_at
         FROM memories WHERE user_id = ?
         ORDER BY created_at DESC LIMIT ?`,
    ).all(userId, n) as MemoryRow[];

    return rows.map(rowToMemory);
}

/**
 * Get total memory count for a user.
 */
export async function getMemoryCount(userId: string): Promise<number> {
    const db = getDb();
    const row = db.prepare(
        `SELECT COUNT(*) as count FROM memories WHERE user_id = ?`,
    ).get(userId) as { count: number };
    return row.count;
}

/**
 * Delete a single memory by ID.
 */
export async function deleteMemory(
    userId: string,
    memoryId: string,
): Promise<boolean> {
    const db = getDb();
    const result = db.prepare(
        `DELETE FROM memories WHERE id = ? AND user_id = ?`,
    ).run(memoryId, userId);
    if (result.changes > 0) {
        logger.debug(`Memory [${userId}]: deleted ${memoryId}`);
    }
    return result.changes > 0;
}

/**
 * Preload notes from vault into memory store (for semantic search).
 * Skips notes that already exist in memory (by text prefix match).
 */
export async function preloadFromVault(
    userId: string,
    notes: Array<{ title: string; content: string }>,
): Promise<number> {
    const db = getDb();
    const existingRows = db.prepare(
        `SELECT text FROM memories WHERE user_id = ?`,
    ).all(userId) as Array<{ text: string }>;

    const existingTexts = new Set(existingRows.map((r) => r.text.slice(0, 80)));

    const insertStmt = db.prepare(
        `INSERT INTO memories (id, user_id, text, tags, embedding, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
    );

    let added = 0;

    for (const note of notes) {
        const memText = `Заметка: ${note.title} — ${note.content.slice(0, 200)}`;
        const prefix = memText.slice(0, 80);
        if (existingTexts.has(prefix)) continue;

        try {
            const embedding = await generateEmbedding(memText);
            insertStmt.run(
                crypto.randomUUID(),
                userId,
                memText,
                JSON.stringify(["vault", "preloaded"]),
                embeddingToBuffer(embedding),
                new Date().toISOString(),
            );
            existingTexts.add(prefix);
            added++;
        } catch {
            // Skip notes that fail embedding
        }
    }

    if (added > 0) {
        logger.debug(`Memory [${userId}]: preloaded ${added} notes from vault`);
    }

    return added;
}
