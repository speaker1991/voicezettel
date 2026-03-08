import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";

/**
 * Yandex SpeechKit v1 TTS API proxy.
 * Synthesizes text to speech via Yandex Cloud.
 *
 * Voices: https://yandex.cloud/en/docs/speechkit/tts/voices
 * - marina (female, default, high quality)
 * - filipp (male)
 * - alena (female)
 * - ermil (male)
 */
const DEFAULT_VOICE = "marina";
const DEFAULT_EMOTION = "neutral";

const YANDEX_TTS_URL = "https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize";

export async function POST(req: NextRequest) {
    const { text, voice } = (await req.json()) as {
        text: string;
        voice?: string;
    };

    if (!text || text.trim().length === 0) {
        return new Response("Empty text", { status: 400 });
    }

    const apiKey = process.env.YANDEX_SPEECHKIT_API_KEY;
    const folderId = process.env.YANDEX_SPEECHKIT_FOLDER_ID;

    if (!apiKey || !folderId) {
        logger.error("Yandex SpeechKit: missing API key or folder ID");
        return new Response("Yandex SpeechKit not configured", { status: 500 });
    }

    try {
        const selectedVoice = voice ?? DEFAULT_VOICE;

        // Yandex SpeechKit v1 uses form-urlencoded body
        const params = new URLSearchParams({
            text: text.slice(0, 5000),
            lang: "ru-RU",
            voice: selectedVoice,
            emotion: DEFAULT_EMOTION,
            format: "mp3",
            sampleRateHertz: "48000",
            folderId,
        });

        const res = await fetch(YANDEX_TTS_URL, {
            method: "POST",
            headers: {
                "Authorization": `Api-Key ${apiKey}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: params.toString(),
        });

        if (!res.ok) {
            const errorText = await res.text();
            logger.error("Yandex SpeechKit error:", res.status, errorText);
            return new Response(`Yandex TTS error: ${res.status}`, { status: 502 });
        }

        // Stream audio directly to client
        const audioData = await res.arrayBuffer();

        return new Response(audioData, {
            headers: {
                "Content-Type": "audio/mpeg",
                "Cache-Control": "no-cache",
                "Content-Length": audioData.byteLength.toString(),
            },
        });
    } catch (err) {
        logger.error("Yandex SpeechKit error:", (err as Error).message);
        return new Response("Yandex TTS error", { status: 500 });
    }
}
