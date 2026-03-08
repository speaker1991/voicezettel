import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";

/**
 * Yandex SpeechKit v1 TTS API proxy.
 * Uses OAuth → IAM token exchange for authentication.
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
const YANDEX_IAM_URL = "https://iam.api.cloud.yandex.net/iam/v1/tokens";

// Cache IAM token (valid for 12 hours, we refresh every 11)
let cachedIamToken: string | null = null;
let iamTokenExpiry = 0;
const IAM_TOKEN_TTL_MS = 11 * 60 * 60 * 1000; // 11 hours

async function getIamToken(): Promise<string> {
    if (cachedIamToken && Date.now() < iamTokenExpiry) {
        return cachedIamToken;
    }

    const oauthToken = process.env.YANDEX_OAUTH_TOKEN;
    if (!oauthToken) {
        throw new Error("YANDEX_OAUTH_TOKEN not configured");
    }

    const res = await fetch(YANDEX_IAM_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yandexPassportOauthToken: oauthToken }),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`IAM token error: ${res.status} ${text}`);
    }

    const data = (await res.json()) as { iamToken: string };
    cachedIamToken = data.iamToken;
    iamTokenExpiry = Date.now() + IAM_TOKEN_TTL_MS;
    return cachedIamToken;
}

export async function POST(req: NextRequest) {
    const { text, voice } = (await req.json()) as {
        text: string;
        voice?: string;
    };

    if (!text || text.trim().length === 0) {
        return new Response("Empty text", { status: 400 });
    }

    const folderId = process.env.YANDEX_SPEECHKIT_FOLDER_ID;
    if (!folderId) {
        logger.error("Yandex SpeechKit: missing folder ID");
        return new Response("Yandex SpeechKit not configured", { status: 500 });
    }

    try {
        const iamToken = await getIamToken();
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
                "Authorization": `Bearer ${iamToken}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: params.toString(),
        });

        if (!res.ok) {
            const errorText = await res.text();
            logger.error("Yandex SpeechKit error:", res.status, errorText);
            // Clear cached token on auth error
            if (res.status === 401) {
                cachedIamToken = null;
                iamTokenExpiry = 0;
            }
            return new Response(`Yandex TTS error: ${res.status}`, { status: 502 });
        }

        // Return audio directly to client
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
