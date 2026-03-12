import { NextResponse } from "next/server";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const REALTIME_SESSION_URL = "https://api.openai.com/v1/realtime/sessions";

export async function POST() {
    if (!OPENAI_API_KEY) {
        return NextResponse.json(
            { error: "OPENAI_API_KEY is not configured on the server." },
            { status: 501 },
        );
    }

    try {
        const response = await fetch(REALTIME_SESSION_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "gpt-realtime-1.5",
                voice: "shimmer",
            }),
        });

        if (!response.ok) {
            const body = (await response.text()) || "Unknown OpenAI error";
            return NextResponse.json(
                { error: `OpenAI API error: ${body}` },
                { status: response.status },
            );
        }

        const data: unknown = await response.json();
        return NextResponse.json(data);
    } catch (err) {
        const message =
            err instanceof Error ? err.message : "Unexpected error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
