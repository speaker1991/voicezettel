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

        const INTERNAL_PATTERNS = [
            "Warning:",
            "Minified React",
            "hydrat",
            "React does not recognize",
            "Invalid DOM property",
            "Each child in a list",
            "Cannot update a component",
            "findDOMNode is deprecated",
            "act(",
            "useLayoutEffect does nothing",
            "ResizeObserver",
            "Non-Error promise rejection",
            "ChunkLoadError",
            "Loading chunk",
            "Failed to load resource",
            "net::ERR_",
            "_next/",
            "webpack",
            "hot-update",
            "HMR",
            "Fast Refresh",
            "nextjs",
            "next-dev",
            "react-dom",
            "Unhandled Runtime Error",
            "Async call stack",
            "[object Object]",
            "data-nextjs",
            "source-map",
            "DevTools",
            "favicon",
            "manifest",
        ];

        console.error = (...args: unknown[]) => {
            origError.apply(console, args);
            const message = args
                .map((a) =>
                    typeof a === "string" ? a : JSON.stringify(a),
                )
                .join(" ");

            const isInternal = INTERNAL_PATTERNS.some((p) =>
                message.includes(p),
            );
            if (!isInternal && message.trim().length > 5) {
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
