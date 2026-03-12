import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const REALTIME_BASE_URL = "https://api.openai.com/v1/realtime";
const REALTIME_MODEL = "gpt-realtime-1.5";

const SdpRequestSchema = z.object({
    sdp: z.string(),
    token: z.string(),
});

export async function POST(req: NextRequest) {
    const raw: unknown = await req.json();
    const parsed = SdpRequestSchema.safeParse(raw);

    if (!parsed.success) {
        return NextResponse.json(
            { error: "Invalid SDP request" },
            { status: 400 },
        );
    }

    if (!OPENAI_API_KEY) {
        return NextResponse.json(
            { error: "OPENAI_API_KEY is not configured" },
            { status: 501 },
        );
    }

    try {
        const response = await fetch(
            `${REALTIME_BASE_URL}?model=${REALTIME_MODEL}`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${parsed.data.token}`,
                    "Content-Type": "application/sdp",
                },
                body: parsed.data.sdp,
            },
        );

        if (!response.ok) {
            const errText = await response.text();
            return NextResponse.json(
                { error: `OpenAI SDP error: ${errText}` },
                { status: response.status },
            );
        }

        const answerSdp = await response.text();
        return new Response(answerSdp, {
            headers: { "Content-Type": "application/sdp" },
        });
    } catch (err) {
        const message =
            err instanceof Error ? err.message : "SDP exchange failed";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
