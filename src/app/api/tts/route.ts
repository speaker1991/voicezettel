import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "EXAVITQu4vr4xnSDxMaL";

export async function POST(req: NextRequest) {
    if (!ELEVENLABS_API_KEY) {
        return new Response("ELEVENLABS_API_KEY not configured", { status: 500 });
    }

    const { text, voiceId } = (await req.json()) as {
        text: string;
        voiceId?: string;
    };

    if (!text || text.trim().length === 0) {
        return new Response("Empty text", { status: 400 });
    }

    try {
        const res = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId ?? DEFAULT_VOICE_ID}/stream`,
            {
                method: "POST",
                headers: {
                    "xi-api-key": ELEVENLABS_API_KEY,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    text: text.slice(0, 5000), // Limit to 5k chars
                    model_id: "eleven_multilingual_v2",
                    voice_settings: { stability: 0.5, similarity_boost: 0.8 },
                }),
            },
        );

        if (!res.ok || !res.body) {
            const errText = await res.text();
            logger.error(`ElevenLabs error ${res.status}: ${errText.slice(0, 200)}`);
            return new Response(`ElevenLabs error ${res.status}`, {
                status: res.status,
            });
        }

        return new Response(res.body, {
            headers: {
                "Content-Type": "audio/mpeg",
                "Cache-Control": "no-cache",
            },
        });
    } catch (err) {
        logger.error("TTS error:", (err as Error).message);
        return new Response("TTS error", { status: 500 });
    }
}
