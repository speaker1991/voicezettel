import { NextRequest } from "next/server";

const SILERO_URL = process.env.SILERO_TTS_URL ?? "http://localhost:8010";
const DEFAULT_SPEAKER = process.env.SILERO_SPEAKER ?? "xenia";
const DEFAULT_SAMPLE_RATE = 48000;

export async function POST(req: NextRequest) {
    const { text, voice } = (await req.json()) as {
        text: string;
        voice?: string;
    };

    if (!text || text.trim().length === 0) {
        return new Response("Empty text", { status: 400 });
    }

    const clean = text
        .replace(/\[COUNTER:\w+\]/gi, "")
        .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "")
        .replace(/[*_#>`~]/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();

    if (!clean || clean.length < 2) {
        return new Response("Text too short", { status: 400 });
    }

    try {
        const params = new URLSearchParams({
            text: clean.slice(0, 900),
            speaker: voice ?? DEFAULT_SPEAKER,
            sample_rate: String(DEFAULT_SAMPLE_RATE),
        });

        const res = await fetch(`${SILERO_URL}/generate?${params.toString()}`, {
            method: "GET",
        });

        if (!res.ok) {
            console.error("[TTS-Local] Silero error:", res.status);
            return new Response("Local TTS error", { status: 502 });
        }

        return new Response(res.body, {
            headers: {
                "Content-Type": "audio/wav",
                "Transfer-Encoding": "chunked",
                "Cache-Control": "no-cache",
            },
        });
    } catch (err) {
        console.error("[TTS-Local] Unavailable:", err);
        return new Response("Local TTS unavailable", { status: 503 });
    }
}
