
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
    },
    warn: (...args: unknown[]) => {
        console.warn("[VoiceZettel]", ...args);
    },
    error: (...args: unknown[]) => {
        console.error("[VoiceZettel]", ...args);
    },
};
