import { NextRequest } from "next/server";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { logger } from "@/lib/logger";

/**
 * Available Russian voices:
 * - ru-RU-SvetlanaNeural (female, default)
 * - ru-RU-DmitryNeural (male)
 * - ru-RU-DariyaNeural (female)
 */
const DEFAULT_VOICE = "ru-RU-SvetlanaNeural";

// ── Module-level TTS instance cache ──────────────────────────
// Avoids WebSocket handshake (200-400ms) on every request
interface TtsCacheEntry {
    tts: MsEdgeTTS;
    lastUsed: number;
}

const ttsCache = new Map<string, TtsCacheEntry>();
const CACHE_TTL = 30_000; // 30 seconds

/** Clean up stale cached instances */
function cleanStaleEntries(): void {
    const now = Date.now();
    for (const [key, entry] of ttsCache) {
        if (now - entry.lastUsed > CACHE_TTL) {
            try { entry.tts.close(); } catch { /* already closed */ }
            ttsCache.delete(key);
        }
    }
}

export async function POST(req: NextRequest) {
    const { text, voice } = (await req.json()) as {
        text: string;
        voice?: string;
    };

    if (!text || text.trim().length === 0) {
        return new Response("Empty text", { status: 400 });
    }

    console.log("[TTS API] Request:", text.slice(0, 50), "voice:", voice);

    try {
        const selectedVoice = voice ?? DEFAULT_VOICE;
        const now = Date.now();

        // Clean stale entries periodically
        cleanStaleEntries();

        // Reuse cached TTS instance or create new one
        let cached = ttsCache.get(selectedVoice);
        if (!cached || now - cached.lastUsed > CACHE_TTL) {
            // Close old instance if exists
            if (cached) {
                try { cached.tts.close(); } catch { /* already closed */ }
            }
            const tts = new MsEdgeTTS();
            await tts.setMetadata(
                selectedVoice,
                OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
            );
            cached = { tts, lastUsed: now };
            ttsCache.set(selectedVoice, cached);
        } else {
            cached.lastUsed = now;
        }

        const { audioStream } = cached.tts.toStream(text.slice(0, 5000));
        console.log("[TTS API] Stream created for:", text.slice(0, 30));

        // Stream audio directly to client (no buffering = lower latency)
        const readableStream = new ReadableStream({
            start(controller) {
                audioStream.on("data", (chunk: Buffer) => {
                    controller.enqueue(new Uint8Array(chunk));
                });
                audioStream.on("end", () => {
                    controller.close();
                });
                audioStream.on("error", (err: Error) => {
                    // If cached instance broke, remove it so next request creates fresh
                    ttsCache.delete(selectedVoice);
                    controller.error(err);
                });
            },
        });

        return new Response(readableStream, {
            headers: {
                "Content-Type": "audio/mpeg",
                "Transfer-Encoding": "chunked",
                "Cache-Control": "no-cache",
            },
        });
    } catch (err) {
        // Remove broken cached instance
        const selectedVoice = voice ?? DEFAULT_VOICE;
        ttsCache.delete(selectedVoice);
        console.error("[TTS API] Error:", (err as Error).message, (err as Error).stack?.slice(0, 200));
        logger.error("Edge TTS error:", (err as Error).message);
        return new Response("TTS error", { status: 500 });
    }
}
