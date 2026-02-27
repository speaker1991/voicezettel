import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const RequestSchema = z.object({
    transcript: z.array(
        z.object({
            text: z.string(),
            timestamp: z.string(),
        }),
    ),
    meetingStartedAt: z.string(),
});

export async function POST(req: NextRequest) {
    if (!OPENAI_API_KEY) {
        return NextResponse.json(
            { error: "API key not configured" },
            { status: 500 },
        );
    }

    const body: unknown = await req.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: "Invalid request" },
            { status: 400 },
        );
    }

    const { transcript, meetingStartedAt } = parsed.data;

    const transcriptText = transcript
        .map(
            (t) =>
                `[${new Date(t.timestamp).toLocaleTimeString("ru-RU")}] ${t.text}`,
        )
        .join("\n");

    const startTime = new Date(meetingStartedAt);
    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();
    const durationMin = Math.round(durationMs / 60000);

    const systemPrompt = `Ты — ассистент  VoiceZettel. Составь краткий ПРОТОКОЛ ВСТРЕЧИ на русском языке.

Формат:
## 📋 Протокол встречи
**Длительность:** ${durationMin} мин.
**Реплик записано:** ${transcript.length}

### Основные темы
- тема 1
- тема 2

### Ключевые решения
- решение 1
- решение 2

### Задачи и действия
- [ ] задача 1
- [ ] задача 2

### Краткое резюме
Одно-два предложения итога.`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "gpt-4o-mini",
            stream: true,
            messages: [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: `Вот транскрипция встречи:\n\n${transcriptText}`,
                },
            ],
        }),
    });

    if (!res.ok || !res.body) {
        const errText = await res.text();
        return NextResponse.json(
            { error: `OpenAI error: ${errText}` },
            { status: 500 },
        );
    }

    return new NextResponse(res.body, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
}
