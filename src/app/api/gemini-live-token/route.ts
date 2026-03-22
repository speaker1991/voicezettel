import { NextResponse } from "next/server";

const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;

export async function POST() {
    if (!GOOGLE_GEMINI_API_KEY) {
        return NextResponse.json(
            { error: "GOOGLE_GEMINI_API_KEY is not configured on the server." },
            { status: 501 },
        );
    }

    const model =
        process.env.GEMINI_LIVE_MODEL ??
        "gemini-2.5-flash-native-audio-preview-12-2025";

    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GOOGLE_GEMINI_API_KEY}`;

    return NextResponse.json({ wsUrl, model });
}
