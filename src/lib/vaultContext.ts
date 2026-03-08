import { readdir, readFile } from "fs/promises";
import { join, extname } from "path";
import { logger } from "@/lib/logger";

const VAULT_PATH = process.env.VAULT_PATH ?? "";
const MAX_CONTEXT_CHARS = 30000;
const CACHE_TTL_MS = 60_000; // 1 minute

interface VaultCache {
    text: string;
    timestamp: number;
}

// Per-user cache
const cacheMap = new Map<string, VaultCache>();

/**
 * Sanitize userId for safe filesystem paths.
 */
function sanitizeUserId(userId: string): string {
    return userId.replace(/[<>:"/\\|?*]/g, "_").slice(0, 100);
}

/**
 * Get user's vault directory.
 */
function getUserVaultDir(userId: string): string {
    return join(VAULT_PATH, sanitizeUserId(userId));
}

/**
 * Recursively collect all .md files from a directory.
 */
async function collectMdFiles(dir: string): Promise<string[]> {
    const results: string[] = [];

    try {
        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = join(dir, entry.name);

            // Skip .obsidian config folder
            if (entry.name.startsWith(".")) continue;

            if (entry.isDirectory()) {
                const nested = await collectMdFiles(fullPath);
                results.push(...nested);
            } else if (extname(entry.name) === ".md") {
                results.push(fullPath);
            }
        }
    } catch {
        // Directory might not exist yet
    }

    return results;
}

/**
 * Load all .md files from the user's vault folder and build text context.
 * Cached per-user for 60 seconds.
 */
export async function loadVaultContext(userId: string): Promise<string> {
    if (!VAULT_PATH) return "";

    const userDir = getUserVaultDir(userId);

    // Return cached if fresh
    const cached = cacheMap.get(userId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.text;
    }

    try {
        const files = await collectMdFiles(userDir);

        if (files.length === 0) return "";

        const chunks: string[] = [];
        let totalChars = 0;

        for (const filePath of files) {
            if (totalChars >= MAX_CONTEXT_CHARS) break;

            try {
                const content = await readFile(filePath, "utf-8");
                const relativePath = filePath
                    .replace(userDir, "")
                    .replace(/\\/g, "/");

                const chunk = `\n--- ${relativePath} ---\n${content.trim()}\n`;

                if (totalChars + chunk.length > MAX_CONTEXT_CHARS) {
                    const remaining = MAX_CONTEXT_CHARS - totalChars;
                    if (remaining > 100) {
                        chunks.push(chunk.slice(0, remaining) + "\n...(обрезано)");
                    }
                    break;
                }

                chunks.push(chunk);
                totalChars += chunk.length;
            } catch {
                // Skip unreadable files
            }
        }

        const result = chunks.join("");

        cacheMap.set(userId, { text: result, timestamp: Date.now() });

        logger.debug(
            `Vault context [${userId}]: ${files.length} files, ${totalChars} chars`,
        );

        return result;
    } catch (err) {
        logger.error(
            `Failed to load vault [${userId}]: ${err instanceof Error ? err.message : "Unknown"}`,
        );
        return "";
    }
}

/**
 * Load vault notes as structured {title, content} pairs for a specific user.
 * Used for preloading into memory store.
 */
export async function loadVaultNotes(
    userId: string,
): Promise<Array<{ title: string; content: string }>> {
    if (!VAULT_PATH) return [];

    const userDir = getUserVaultDir(userId);

    try {
        const files = await collectMdFiles(userDir);
        const notes: Array<{ title: string; content: string }> = [];

        for (const filePath of files) {
            try {
                const content = await readFile(filePath, "utf-8");
                const headingMatch = /^#\s+(.+)$/m.exec(content);
                const fileName = filePath
                    .replace(/\\/g, "/")
                    .split("/")
                    .pop()
                    ?.replace(".md", "");
                const title =
                    headingMatch?.[1] ?? fileName ?? "Untitled";

                // Skip very short or empty notes
                if (content.trim().length < 20) continue;

                notes.push({ title, content: content.trim() });
            } catch {
                // Skip unreadable files
            }
        }

        return notes;
    } catch {
        return [];
    }
}
