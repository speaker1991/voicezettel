import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const PIPER_URL = process.env.PIPER_TTS_URL ?? "http://127.0.0.1:8011";

export async function POST(req: NextRequest) {
    try {
        const { text } = (await req.json()) as { text: string };

        if (!text || text.trim().length === 0) {
            return NextResponse.json({ error: "Empty text" }, { status: 400 });
        }

        const clean = text
            .replace(/\[COUNTER:\w+\]/gi, "")
            .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "")
            .replace(/[*_#>`~]/g, "")
            .replace(/\s{2,}/g, " ")
            .trim();

        if (!clean || clean.length < 2) {
            return NextResponse.json({ error: "Text too short" }, { status: 400 });
        }

        const response = await fetch(PIPER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: clean.slice(0, 900) }),
        });

        if (!response.ok) {
            console.error("[tts-piper] Piper server error:", response.status);
            return NextResponse.json({ error: "Piper server error" }, { status: 502 });
        }

        const audioBuffer = await response.arrayBuffer();
        return new NextResponse(audioBuffer, {
            status: 200,
            headers: {
                "Content-Type": "audio/wav",
                "Content-Length": String(audioBuffer.byteLength),
                "Cache-Control": "no-store",
            },
        });
    } catch (e) {
        console.error("[tts-piper] error:", e);
        return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
}
