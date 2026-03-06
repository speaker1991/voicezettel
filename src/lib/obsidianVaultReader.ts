"use client";

import { logger } from "@/lib/logger";
import { useSettingsStore } from "@/stores/settingsStore";

interface VaultNote {
    path: string;
    content: string;
}

interface VaultCache {
    notes: VaultNote[];
    timestamp: number;
}

const CACHE_TTL_MS = 60_000; // 1 minute
const MAX_CONTEXT_CHARS = 15_000; // Keep context reasonable for voice mode
let cache: VaultCache | null = null;

/**
 * Fetch all .md file paths from user's local Obsidian REST API.
 */
async function listVaultFiles(
    apiUrl: string,
    apiKey: string,
): Promise<string[]> {
    const url = `${apiUrl}/vault/`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) return [];

    const data = (await res.json()) as { files?: string[] };
    return (data.files ?? []).filter(
        (f) => f.endsWith(".md") && !f.startsWith("."),
    );
}

/**
 * Fetch a single file's content from user's local Obsidian REST API.
 */
async function readVaultFile(
    apiUrl: string,
    apiKey: string,
    path: string,
): Promise<string> {
    const url = `${apiUrl}/vault/${encodeURIComponent(path)}`;
    const res = await fetch(url, {
        headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "text/markdown",
        },
    });

    if (!res.ok) return "";
    return res.text();
}

/**
 * Load all notes from user's Obsidian vault via REST API.
 * Cached for 60 seconds.
 */
export async function fetchVaultNotes(): Promise<VaultNote[]> {
    const { obsidianApiKey, obsidianApiUrl } = useSettingsStore.getState();
    if (!obsidianApiKey || !obsidianApiUrl) return [];

    // Return cached if fresh
    if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
        return cache.notes;
    }

    try {
        const files = await listVaultFiles(obsidianApiUrl, obsidianApiKey);
        if (files.length === 0) return [];

        // Read files in parallel (batch of 10)
        const notes: VaultNote[] = [];
        for (let i = 0; i < files.length; i += 10) {
            const batch = files.slice(i, i + 10);
            const results = await Promise.allSettled(
                batch.map(async (path) => {
                    const content = await readVaultFile(
                        obsidianApiUrl,
                        obsidianApiKey,
                        path,
                    );
                    return { path, content };
                }),
            );

            for (const result of results) {
                if (
                    result.status === "fulfilled" &&
                    result.value.content.trim().length > 20
                ) {
                    notes.push(result.value);
                }
            }
        }

        cache = { notes, timestamp: Date.now() };
        logger.debug(`Vault loaded: ${notes.length} notes from Obsidian API`);
        return notes;
    } catch {
        logger.debug("Failed to load vault from Obsidian API");
        return [];
    }
}

/**
 * Build a text context string from vault notes for AI context injection.
 */
export async function buildVaultContext(): Promise<string> {
    const notes = await fetchVaultNotes();
    if (notes.length === 0) return "";

    const parts: string[] = ["--- OBSIDIAN NOTES ---"];
    let totalChars = 0;

    for (const note of notes) {
        const chunk = `\n### ${note.path}\n${note.content.trim()}\n`;
        if (totalChars + chunk.length > MAX_CONTEXT_CHARS) {
            const remaining = MAX_CONTEXT_CHARS - totalChars;
            if (remaining > 100) {
                parts.push(chunk.slice(0, remaining) + "\n...(обрезано)");
            }
            break;
        }
        parts.push(chunk);
        totalChars += chunk.length;
    }

    parts.push("--- END NOTES ---");
    return parts.join("\n");
}
