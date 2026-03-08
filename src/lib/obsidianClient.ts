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

// ── Deduplication guard ──────────────────────────────────────
const recentSends: Map<string, number> = new Map();
const DEDUP_WINDOW_MS = 30_000; // 30 seconds

function isDuplicate(userText: string, assistantText: string): boolean {
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
 * Send dialog to server for Zettelkasten processing + archive.
 * Server writes to user's folder in VAULT_PATH/<userId>/
 */
export async function sendToObsidian(
    userText: string,
    assistantText: string,
    userId?: string,
): Promise<void> {
    // Skip duplicates within 30 seconds
    if (isDuplicate(userText, assistantText)) return;

    const { aiProvider } = useSettingsStore.getState();

    try {
        const res = await fetch("/api/obsidian", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                userText,
                assistantText,
                provider: aiProvider,
                userId: userId ?? "anonymous",
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

        // Show notification about saved notes
        if (data.results && data.notes && data.notes > 0) {
            const savedCount = data.results.filter((r) => r.success).length;
            if (savedCount > 0) {
                logger.debug(
                    `Zettelkasten: ${savedCount} note(s) → Obsidian`,
                );
                useNotificationStore
                    .getState()
                    .addNotification(
                        `📓 ${savedCount} заметок → Obsidian`,
                        "info",
                    );
            }
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        logger.error(`Obsidian error: ${msg}`);
    }
}
