"use client";

import { useEffect } from "react";
import { useNotificationStore } from "@/stores/notificationStore";

/**
 * Intercepts console.error and console.warn, 
 * sends them to the notification bell,
 * and removes the Next.js dev error overlay from DOM.
 */
export function DevOverlaySuppressor() {
    useEffect(() => {
        if (process.env.NODE_ENV !== "development") return;

        // 1. Intercept console.error → push to notification bell
        const origError = console.error;

        // Pattern: only show errors with Cyrillic text (= our app messages)
        // This blocks ALL internal React/Next/Webpack English errors
        const HAS_CYRILLIC = /[\u0400-\u04FF]/;

        console.error = (...args: unknown[]) => {
            origError.apply(console, args);
            const message = args
                .map((a) =>
                    typeof a === "string" ? a : JSON.stringify(a),
                )
                .join(" ");

            // Only show messages that contain Russian text (our notifications)
            if (HAS_CYRILLIC.test(message) && message.trim().length > 5) {
                useNotificationStore
                    .getState()
                    .addNotification(message.slice(0, 200), "error");
            }
        };

        // 2. Observe DOM for Next.js error overlay and hide it
        const observer = new MutationObserver(() => {
            const portal = document.querySelector("nextjs-portal");
            if (portal && portal instanceof HTMLElement) {
                portal.style.display = "none";
            }
            // Also target shadow DOM host elements
            document
                .querySelectorAll("[data-nextjs-toast]")
                .forEach((el) => {
                    if (el instanceof HTMLElement)
                        el.style.display = "none";
                });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        return () => {
            console.error = origError;
            observer.disconnect();
        };
    }, []);

    return null;
}
