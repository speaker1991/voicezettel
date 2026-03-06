import { logger } from "@/lib/logger";
import { useNotificationStore } from "@/stores/notificationStore";
import { useSettingsStore } from "@/stores/settingsStore";

interface NoteResult {
    title: string;
    content: string;
    success: boolean;
    error?: string;
    method: string;
}

interface ObsidianApiResponse {
    skipped?: boolean;
    notes?: number;
    results?: NoteResult[];
    error?: string;
}

/**
 * PUT a note directly to user's local Obsidian REST API (from browser).
 * Works because the browser runs on the same machine as Obsidian.
 */
async function putToLocalObsidian(
    apiUrl: string,
    apiKey: string,
    title: string,
    content: string,
): Promise<boolean> {
    const filename = `${title}.md`;
    const path = `Zettelkasten/${filename}`;
    const url = `${apiUrl}/vault/${encodeURIComponent(path)}`;

    try {
        const res = await fetch(url, {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "text/markdown",
            },
            body: content,
        });

        return res.ok;
    } catch {
        return false;
    }
}

/**
 * Append dialog entry to Archive/YYYY-MM-DD.md in user's local Obsidian.
 * Uses PATCH (append) if available, otherwise reads + appends + PUTs.
 */
async function appendArchiveToLocalObsidian(
    apiUrl: string,
    apiKey: string,
    userText: string,
    assistantText: string,
): Promise<boolean> {
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const time = now.toTimeString().slice(0, 8);

    const path = `Archive/${today}.md`;
    const url = `${apiUrl}/vault/${encodeURIComponent(path)}`;

    const entry = `\n---\n**${time}**\n\n🗣 **Пользователь:** ${userText}\n\n🤖 **Ассистент:** ${assistantText}\n`;

    try {
        // Try to GET existing content
        const getRes = await fetch(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${apiKey}` },
        });

        let fullContent: string;
        if (getRes.ok) {
            const existing = await getRes.text();
            fullContent = existing + entry;
        } else {
            // File doesn't exist — create with header
            const header = `# 📅 Сессия ${today}\n\nАрхив диалогов VoiceZettel за ${today}.\n\nТеги: #archive #session\n`;
            fullContent = header + entry;
        }

        // PUT full content
        const putRes = await fetch(url, {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "text/markdown",
            },
            body: fullContent,
        });

        return putRes.ok;
    } catch {
        return false;
    }
}

// ── Deduplication guard ──────────────────────────────────────
const recentSends: Map<string, number> = new Map();
const DEDUP_WINDOW_MS = 30_000; // 30 seconds

function isDuplicate(userText: string, assistantText: string): boolean {
    // Simple hash from content
    const key = `${userText.slice(0, 100)}|${assistantText.slice(0, 100)}`;
    const now = Date.now();

    // Clean old entries
    for (const [k, ts] of recentSends) {
        if (now - ts > DEDUP_WINDOW_MS) recentSends.delete(k);
    }

    if (recentSends.has(key)) {
        logger.debug("Zettelkasten: duplicate detected, skipping");
        return true;
    }

    recentSends.set(key, now);
    return false;
}

/**
 * Send dialog to server for Zettelkasten processing.
 * Server writes to VAULT_PATH if configured (owner).
 * If user has local Obsidian API key → browser PUTs directly (other users).
 */
export async function sendToObsidian(
    userText: string,
    assistantText: string,
): Promise<void> {
    // Skip duplicates within 30 seconds
    if (isDuplicate(userText, assistantText)) return;

    const { aiProvider, obsidianApiKey, obsidianApiUrl } =
        useSettingsStore.getState();

    try {
        const res = await fetch("/api/obsidian", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                userText,
                assistantText,
                provider: aiProvider,
                hasLocalApi: Boolean(obsidianApiKey),
            }),
        });

        if (!res.ok) {
            const errBody = await res
                .json()
                .catch(() => ({ error: "Unknown" }));
            throw new Error(
                (errBody as { error?: string }).error ??
                `HTTP ${res.status}`,
            );
        }

        const data = (await res.json()) as ObsidianApiResponse;

        if (data.error) throw new Error(data.error);
        if (data.skipped) {
            logger.debug("Zettelkasten: skipped (no valuable ideas)");
            return;
        }

        // Client-side PUT to local Obsidian (user must have their own API key)
        if (obsidianApiKey && data.results) {
            // Save archive entry (fire-and-forget)
            void appendArchiveToLocalObsidian(
                obsidianApiUrl,
                obsidianApiKey,
                userText,
                assistantText,
            );

            // Save zettelkasten notes
            let clientSaved = 0;
            for (const note of data.results) {
                const ok = await putToLocalObsidian(
                    obsidianApiUrl,
                    obsidianApiKey,
                    note.title,
                    note.content,
                );
                if (ok) clientSaved++;
            }

            if (clientSaved > 0) {
                logger.debug(
                    `Zettelkasten: ${clientSaved} note(s) → local Obsidian`,
                );
                useNotificationStore
                    .getState()
                    .addNotification(
                        `📓 ${clientSaved} заметок → Obsidian`,
                        "info",
                    );
            }
        }
        // If no API key — notes are generated but not saved anywhere
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        logger.error(`Obsidian error: ${msg}`);
    }
}
