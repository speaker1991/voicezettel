/**
 * Remote logger — sends important client-side events to /api/logs.
 * Uses fire-and-forget fetch with batching to reduce network overhead.
 */

import type { LogLevel } from "@/types/admin";

interface PendingLog {
    userId: string;
    level: LogLevel;
    source: string;
    message: string;
    category?: string;
    context?: Record<string, unknown>;
}

const FLUSH_INTERVAL_MS = 3000;
const MAX_BATCH = 20;

let buffer: PendingLog[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushBuffer();
    }, FLUSH_INTERVAL_MS);
}

async function flushBuffer(): Promise<void> {
    if (buffer.length === 0) return;
    const batch = buffer.splice(0, MAX_BATCH);

    for (const log of batch) {
        try {
            await fetch("/api/logs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(log),
            });
        } catch {
            // Network failure — drop the log silently
        }
    }

    // If more items remain, schedule another flush
    if (buffer.length > 0) {
        scheduleFlush();
    }
}

function pushLog(entry: PendingLog): void {
    buffer.push(entry);
    if (buffer.length >= MAX_BATCH) {
        void flushBuffer();
    } else {
        scheduleFlush();
    }
}

/**
 * Create a scoped remote logger for a specific userId and source.
 * Usage:
 *   const rlog = createRemoteLogger("user@email.com", "voice");
 *   rlog.error("WebRTC failed", { browser: "Safari" });
 */
export function createRemoteLogger(userId: string, source: string) {
    return {
        info: (message: string, context?: Record<string, unknown>) =>
            pushLog({ userId, level: "INFO", source, message, context }),

        warn: (message: string, context?: Record<string, unknown>) =>
            pushLog({ userId, level: "WARN", source, message, context }),

        error: (message: string, context?: Record<string, unknown>) =>
            pushLog({ userId, level: "ERROR", source, message, context }),
    };
}

/**
 * Install global error handlers that log unhandled errors.
 * Should be called once at app startup.
 */
export function installGlobalErrorHandlers(userId: string): () => void {
    const rlog = createRemoteLogger(userId, "global");

    const onError = (event: ErrorEvent) => {
        rlog.error(`Unhandled: ${event.message}`, {
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
        });
    };

    const onRejection = (event: PromiseRejectionEvent) => {
        const msg = event.reason instanceof Error
            ? event.reason.message
            : String(event.reason);
        rlog.error(`Unhandled promise: ${msg}`);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
        window.removeEventListener("error", onError);
        window.removeEventListener("unhandledrejection", onRejection);
    };
}
