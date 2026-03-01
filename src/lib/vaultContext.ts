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

let cache: VaultCache | null = null;

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
 * Load all .md files from the vault and build a text context
 * for the AI assistant. Cached for 60 seconds.
 */
export async function loadVaultContext(): Promise<string> {
    if (!VAULT_PATH) return "";

    // Return cached if fresh
    if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
        return cache.text;
    }

    try {
        const files = await collectMdFiles(VAULT_PATH);

        if (files.length === 0) return "";

        const chunks: string[] = [];
        let totalChars = 0;

        for (const filePath of files) {
            if (totalChars >= MAX_CONTEXT_CHARS) break;

            try {
                const content = await readFile(filePath, "utf-8");
                const relativePath = filePath
                    .replace(VAULT_PATH, "")
                    .replace(/\\/g, "/");

                const chunk = `\n--- ${relativePath} ---\n${content.trim()}\n`;

                if (totalChars + chunk.length > MAX_CONTEXT_CHARS) {
                    // Add truncated version
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

        cache = { text: result, timestamp: Date.now() };

        logger.debug(
            `Vault context loaded: ${files.length} files, ${totalChars} chars`,
        );

        return result;
    } catch (err) {
        logger.error(
            `Failed to load vault: ${err instanceof Error ? err.message : "Unknown"}`,
        );
        return "";
    }
}

/**
 * Load vault notes as structured {title, content} pairs.
 * Used for preloading into memory store.
 */
export async function loadVaultNotes(): Promise<
    Array<{ title: string; content: string }>
> {
    if (!VAULT_PATH) return [];

    try {
        const files = await collectMdFiles(VAULT_PATH);
        const notes: Array<{ title: string; content: string }> = [];

        for (const filePath of files) {
            try {
                const content = await readFile(filePath, "utf-8");
                // Extract title from heading or filename
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
