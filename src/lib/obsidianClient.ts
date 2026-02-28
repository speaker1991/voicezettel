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
    const path = `10_Zettels/${filename}`;
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
 * Send dialog to server for Zettelkasten processing.
 * Server writes to VAULT_PATH if configured (owner).
 * If user has local Obsidian API key → browser PUTs directly (other users).
 */
export async function sendToObsidian(
    userText: string,
    assistantText: string,
): Promise<void> {
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

        // Client-side PUT to local Obsidian (for users with their own API key)
        if (obsidianApiKey && data.results) {
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
        } else {
            // Server-side write (owner) — already handled
            const saved = data.results?.filter((r) => r.success) ?? [];
            if (saved.length > 0) {
                logger.debug(
                    `Zettelkasten: ${saved.length} note(s) → vault (${saved[0].method})`,
                );
            }
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        logger.error(`Obsidian error: ${msg}`);
    }
}
