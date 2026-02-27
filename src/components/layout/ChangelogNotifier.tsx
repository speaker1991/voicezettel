"use client";

import { useEffect } from "react";
import { CHANGELOG } from "@/lib/changelog";
import { useNotificationStore } from "@/stores/notificationStore";

const STORAGE_KEY = "voicezettel-seen-changelog";

function getSeenIds(): Set<string> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return new Set();
        return new Set(JSON.parse(raw) as string[]);
    } catch {
        return new Set();
    }
}

function markSeen(ids: string[]) {
    const existing = getSeenIds();
    for (const id of ids) existing.add(id);
    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([...existing]),
    );
}

/**
 * On mount, checks CHANGELOG for entries the user hasn't seen yet
 * and pushes them to the notification bell.
 */
export function ChangelogNotifier() {
    useEffect(() => {
        const seen = getSeenIds();
        const newEntries = CHANGELOG.filter((e) => !seen.has(e.id));

        if (newEntries.length === 0) return;

        // Small delay so it feels natural after page load
        const timer = setTimeout(() => {
            const store = useNotificationStore.getState();
            for (const entry of newEntries.reverse()) {
                store.addNotification(entry.message, entry.level);
            }
            markSeen(newEntries.map((e) => e.id));
        }, 1500);

        return () => clearTimeout(timer);
    }, []);

    return null;
}
