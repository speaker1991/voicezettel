
/**
 * Thin logger wrapper.
 * In production builds, debug and warn are no-ops.
 * Replaces direct console.log usage across the codebase.
 */

const isDev = process.env.NODE_ENV !== "production";

export const logger = {
    debug: (...args: unknown[]) => {
        if (isDev) console.debug("[VoiceZettel]", ...args);
    },
    info: (...args: unknown[]) => {
        if (isDev) console.info("[VoiceZettel]", ...args);
        logger.remoteLog("info", String(args[0] ?? ""), args.slice(1));
    },
    warn: (...args: unknown[]) => {
        console.warn("[VoiceZettel]", ...args);
        logger.remoteLog("info", String(args[0] ?? ""), args.slice(1));
    },
    error: (...args: unknown[]) => {
        console.error("[VoiceZettel]", ...args);
        logger.remoteLog("error", String(args[0] ?? ""), args.slice(1));
    },
    remoteLog: (level: "info" | "error", message: string, data?: unknown): void => {
        if (typeof window === "undefined") return;
        // RemoteLogPayloadSchema requires: userId, level (INFO/ERROR/WARN), source, message
        const levelMap = { info: "INFO", error: "ERROR" } as const;
        const userId = document.cookie
            .split("; ")
            .find((c) => c.startsWith("userId="))
            ?.split("=")[1] ?? "anonymous";
        fetch("/api/logs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                userId,
                level: levelMap[level],
                source: "client-gemini",
                message,
                context: data != null ? { data } : undefined,
            }),
        }).catch(() => {});
    },
};
