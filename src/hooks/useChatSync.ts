"use client";

import { useEffect, useRef } from "react";
import { useChatStore } from "@/stores/chatStore";
import { useCountersStore } from "@/stores/countersStore";
import { useUser } from "@/components/providers/UserProvider";
import { logger } from "@/lib/logger";

const SAVE_DEBOUNCE_MS = 1500;

/**
 * Syncs chat messages with the server:
 * - Loads from server on mount
 * - Saves to server on every change (debounced)
 */
export function useChatSync() {
    const { userId } = useUser();
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const loadedRef = useRef(false);

    // Start with empty chat on each page load (no history restore)
    useEffect(() => {
        if (userId === "anonymous" || loadedRef.current) return;
        loadedRef.current = true;

        // Also load persisted token usage
        void useCountersStore.getState().loadTokensFromServer(userId);
    }, [userId]);

    // Subscribe to message changes and save to server (debounced)
    useEffect(() => {
        if (userId === "anonymous") return;

        const unsubscribe = useChatStore.subscribe((state, prevState) => {
            if (state.messages === prevState.messages) return;
            if (state.messages.length === 0) return;

            // Debounce save
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

            saveTimerRef.current = setTimeout(async () => {
                try {
                    await fetch("/api/chat-history", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            userId,
                            messages: state.messages.map((m) => ({
                                id: m.id,
                                role: m.role,
                                content: m.content,
                                timestamp: m.timestamp,
                                source: m.source,
                            })),
                        }),
                    });
                } catch {
                    // Silently fail — next change will retry
                }
            }, SAVE_DEBOUNCE_MS);
        });

        return () => {
            unsubscribe();
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        };
    }, [userId]);
}
