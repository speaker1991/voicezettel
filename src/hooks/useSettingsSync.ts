"use client";

import { useEffect, useRef } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { logger } from "@/lib/logger";

/**
 * Hook that syncs settings to/from server when user is logged in.
 * - On mount: fetches server settings and merges with local
 * - On change: debounced save to server
 */
export function useSettingsSync(userId: string | null) {
    const hasLoaded = useRef(false);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Load settings from server on first mount
    useEffect(() => {
        if (!userId || hasLoaded.current) return;
        hasLoaded.current = true;

        void (async () => {
            try {
                const res = await fetch(
                    `/api/settings?userId=${encodeURIComponent(userId)}`,
                );
                if (!res.ok) return;

                const data = (await res.json()) as {
                    settings: Record<string, unknown> | null;
                };
                if (!data.settings) return;

                // Merge server settings into local store
                // (server values override local, keeping any new local-only fields)
                const current = useSettingsStore.getState() as unknown as Record<string, unknown>;
                const merged: Record<string, unknown> = {};
                for (const key of Object.keys(data.settings)) {
                    // Only merge data fields, not functions
                    if (typeof current[key] !== "function") {
                        merged[key] = data.settings[key];
                    }
                }

                if (Object.keys(merged).length > 0) {
                    useSettingsStore.setState(merged);
                    logger.debug("Settings loaded from server");
                }
            } catch {
                // Silent — use local settings
            }
        })();
    }, [userId]);

    // Save settings to server on change (debounced 2s)
    useEffect(() => {
        if (!userId) return;

        const unsub = useSettingsStore.subscribe((state) => {
            // Clear previous timer
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
            }

            // Debounce: save after 2 seconds of no changes
            saveTimerRef.current = setTimeout(() => {
                // Extract only data fields (no functions)
                const data: Record<string, unknown> = {};
                for (const [key, value] of Object.entries(state)) {
                    if (typeof value !== "function") {
                        data[key] = value;
                    }
                }

                void fetch("/api/settings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userId, settings: data }),
                }).catch(() => { /* silent */ });
            }, 2000);
        });

        return () => {
            unsub();
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
            }
        };
    }, [userId]);
}
