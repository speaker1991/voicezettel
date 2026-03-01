import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { generateEmbedding, cosineSimilarity } from "@/lib/embeddings";
import { logger } from "@/lib/logger";
import type { Memory, MemorySearchResult, MemoryStoreData } from "@/types/memory";

const DATA_DIR = join(process.cwd(), "data");
const SEARCH_TOP_K = 5;
const SEARCH_THRESHOLD = 0.3;
const DEBOUNCE_MS = 2000;

// ── Per-user in-memory storage ───────────────────────────────
const userStores: Map<string, Map<string, Memory>> = new Map();
const loadedUsers: Set<string> = new Set();
const saveTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

function getStorePath(userId: string): string {
    // Sanitize userId for filesystem (remove special chars)
    const safe = userId.replace(/[^a-zA-Z0-9@._-]/g, "_");
    return join(DATA_DIR, `memory_${safe}.json`);
}

function getStore(userId: string): Map<string, Memory> {
    let store = userStores.get(userId);
    if (!store) {
        store = new Map();
        userStores.set(userId, store);
    }
    return store;
}

// ── Load from disk ───────────────────────────────────────────
async function ensureLoaded(userId: string): Promise<void> {
    if (loadedUsers.has(userId)) return;
    loadedUsers.add(userId);

    const storePath = getStorePath(userId);
    const store = getStore(userId);

    try {
        const raw = await readFile(storePath, "utf-8");
        const data = JSON.parse(raw) as MemoryStoreData;

        for (const mem of data.memories) {
            store.set(mem.id, mem);
        }

        logger.debug(`Memory store [${userId}]: loaded ${store.size} memories`);
    } catch {
        logger.debug(`Memory store [${userId}]: starting fresh`);
    }
}

// ── Debounced save to disk ───────────────────────────────────
function scheduleSave(userId: string): void {
    const existing = saveTimers.get(userId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
        const store = getStore(userId);
        const storePath = getStorePath(userId);

        try {
            const data: MemoryStoreData = {
                memories: Array.from(store.values()),
                version: 1,
            };

            await mkdir(dirname(storePath), { recursive: true });
            await writeFile(storePath, JSON.stringify(data), "utf-8");
            logger.debug(`Memory store [${userId}]: saved ${store.size} memories`);
        } catch (err) {
            logger.error(
                `Memory save error [${userId}]: ${err instanceof Error ? err.message : "Unknown"}`,
            );
        }
    }, DEBOUNCE_MS);

    saveTimers.set(userId, timer);
}

// ── Public API ───────────────────────────────────────────────

/**
 * Save a new memory with auto-generated embedding.
 */
export async function saveMemory(
    userId: string,
    text: string,
    tags: string[] = [],
): Promise<Memory> {
    await ensureLoaded(userId);

    const embedding = await generateEmbedding(text);
    const store = getStore(userId);

    const memory: Memory = {
        id: crypto.randomUUID(),
        text,
        tags,
        createdAt: new Date().toISOString(),
        embedding,
    };

    store.set(memory.id, memory);
    scheduleSave(userId);

    logger.debug(`Memory [${userId}]: saved "${text.slice(0, 50)}..." [${tags.join(", ")}]`);

    return memory;
}

/**
 * Search memories by cosine similarity.
 */
export async function searchMemories(
    userId: string,
    query: string,
): Promise<MemorySearchResult[]> {
    await ensureLoaded(userId);

    const store = getStore(userId);
    if (store.size === 0) return [];

    const queryEmbedding = await generateEmbedding(query);

    const isZero = queryEmbedding.every((v) => v === 0);
    if (isZero) return [];

    const results: MemorySearchResult[] = [];

    for (const memory of store.values()) {
        const score = cosineSimilarity(queryEmbedding, memory.embedding);
        if (score >= SEARCH_THRESHOLD) {
            results.push({ memory, score });
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
    await ensureLoaded(userId);

    const store = getStore(userId);
    const all = Array.from(store.values());
    all.sort(
        (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return all.slice(0, n);
}

/**
 * Get total memory count for a user.
 */
export async function getMemoryCount(userId: string): Promise<number> {
    await ensureLoaded(userId);
    return getStore(userId).size;
}
