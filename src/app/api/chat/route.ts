import { NextRequest, NextResponse } from "next/server";
import { ChatRequestSchema } from "./types";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;

// ── OpenAI streaming ─────────────────────────────────────────
async function streamOpenAI(
    messages: Array<{ role: string; content: string }>,
    systemPrompt?: string,
): Promise<ReadableStream<Uint8Array>> {
    const body = {
        model: "gpt-4o-mini",
        stream: true,
        stream_options: { include_usage: true },
        messages: [
            ...(systemPrompt
                ? [{ role: "system" as const, content: systemPrompt }]
                : []),
            ...messages,
        ],
    };

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) {
        const errText = await res.text();
        throw new Error(`OpenAI error ${res.status}: ${errText}`);
    }

    return res.body;
}

// ── Google Gemini streaming ──────────────────────────────────
async function streamGemini(
    messages: Array<{ role: string; content: string }>,
    systemPrompt?: string,
): Promise<ReadableStream<Uint8Array>> {
    if (!GOOGLE_GEMINI_API_KEY) {
        throw new Error("GOOGLE_GEMINI_API_KEY is not configured");
    }

    const contents = messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
    }));

    const body: Record<string, unknown> = {
        contents,
        generationConfig: { temperature: 0.7 },
    };

    if (systemPrompt) {
        body.systemInstruction = {
            parts: [{ text: systemPrompt }],
        };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${GOOGLE_GEMINI_API_KEY}`;

    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) {
        const errText = await res.text();
        throw new Error(`Gemini error ${res.status}: ${errText}`);
    }

    // Transform Gemini SSE to OpenAI-compatible SSE format
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            const { done, value } = await reader.read();
            if (done) {
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
                return;
            }

            const text = decoder.decode(value, { stream: true });
            const lines = text.split("\n");

            for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const jsonStr = line.slice(6).trim();
                if (!jsonStr || jsonStr === "[DONE]") continue;

                try {
                    const parsed = JSON.parse(jsonStr) as {
                        candidates?: Array<{
                            content?: {
                                parts?: Array<{ text?: string }>;
                            };
                        }>;
                    };
                    const part = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (part) {
                        // Emit in OpenAI-compatible format
                        const chunk = JSON.stringify({
                            choices: [
                                { delta: { content: part }, index: 0 },
                            ],
                        });
                        controller.enqueue(
                            encoder.encode(`data: ${chunk}\n\n`),
                        );
                    }
                } catch {
                    // skip unparseable lines
                }
            }
        },
    });
}

// ── Route handler ────────────────────────────────────────────
export async function POST(req: NextRequest) {
    const raw: unknown = await req.json();
    const parsed = ChatRequestSchema.safeParse(raw);

    if (!parsed.success) {
        return NextResponse.json(
            { error: "Invalid request", details: parsed.error.flatten() },
            { status: 400 },
        );
    }

    const { messages, provider, systemPrompt } = parsed.data;

    if (provider === "openai" && !OPENAI_API_KEY) {
        return NextResponse.json(
            { error: "OPENAI_API_KEY is not configured" },
            { status: 501 },
        );
    }

    if (provider === "google" && !GOOGLE_GEMINI_API_KEY) {
        return NextResponse.json(
            { error: "GOOGLE_GEMINI_API_KEY is not configured" },
            { status: 501 },
        );
    }

    try {
        const stream =
            provider === "google"
                ? await streamGemini(messages, systemPrompt)
                : await streamOpenAI(messages, systemPrompt);

        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            },
        });
    } catch (err) {
        const message =
            err instanceof Error ? err.message : "Unexpected error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
