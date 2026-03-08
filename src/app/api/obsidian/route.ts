import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appendToSessionArchive, writeNoteToVault } from "@/lib/vaultWriter";
import { logger } from "@/lib/logger";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// ── Request schema ───────────────────────────────────────────
const RequestSchema = z.object({
    userText: z.string().min(1),
    assistantText: z.string().min(1),
    provider: z.enum(["openai", "google", "deepseek"]).default("deepseek"),
    userId: z.string().default("anonymous"),
});

const ZETTELKASTEN_SYSTEM_PROMPT = `Ты — мой Экзокортекс, мой «Второй Разум». Твоя задача — в реальном времени анализировать поток диалогов и превращать мысли в идеальные атомарные заметки по методу Zettelkasten.

ПРИНЦИПЫ РАБОТЫ:
- Атомарность (Atomicity): Одна идея = одна заметка. Если в монологе прозвучало три мысли — создай три заметки, разделённые маркером ---SPLIT---
- Автономность (Autonomy): Каждая заметка понятна без контекста диалога.
- Практическая польза (Productive Thinking): Каждая концепция должна перекидывать мост между теорией и ежедневными действиями.

ФОРМАТ ОТВЕТА — чистый Markdown для КАЖДОЙ заметки:

---
id: "{{timestamp}}"
title: "{{title}}"
type: zettel
tags: [zettel, идея, добавь_2-3_тега]
source: voice-dialog
created: "{{datetime}}"
---

# [Декларативный заголовок-утверждение в 3-5 словах]

### 💡 Суть идеи (Своими словами)
[Переформулируй мысль максимально ясно и глубоко. 3-5 предложений.]

### 🛠 Как это улучшит мою жизнь (Практическое применение)
[Конкретное действие, правило или ментальная установка.]

### 🧭 Компас Идей (Связи)
- Север (К какому большему паттерну/теме это относится?): [[...]]
- Юг (Из какого корня/причины это растёт?): [[...]]
- Восток (Какой контраргумент или противоречие?): [[...]]
- Запад (Какая аналогия из совершенно другой области?): [[...]]

### 🎙 Контекст диалога
> [Кратко, в каком разговоре и при каких обстоятельствах эта мысль появилась]

Если несколько заметок — раздели их маркером ---SPLIT---
Отвечай ТОЛЬКО Markdown-кодом заметок, без пояснений.

Если в тексте нет абсолютно никакой полезной информации (например, просто «привет», «как дела?», «спасибо») — ответь словом "SKIP".
Практические задачи, планы, бытовые идеи и any to-do — это НЕ повод для SKIP, это тоже ценные заметки.`;

// ── Extract title from markdown ──────────────────────────────
function extractTitle(markdown: string): string {
    const headingMatch = /^#\s+(.+)$/m.exec(markdown);
    if (headingMatch) {
        return headingMatch[1]
            .replace(/[\\/:*?"<>|]/g, "")
            .trim()
            .slice(0, 100);
    }

    const titleMatch = /title:\s*"?(.+?)"?\s*$/m.exec(markdown);
    if (titleMatch) {
        return titleMatch[1]
            .replace(/[\\/:*?"<>|]/g, "")
            .trim()
            .slice(0, 100);
    }

    return `zettel-${Date.now()}`;
}

// ── Generate timestamp ID ────────────────────────────────────
function makeTimestamp(): string {
    return new Date()
        .toISOString()
        .replace(/[-T:.Z]/g, "")
        .slice(0, 14);
}

// ── DeepSeek helper (OpenAI-compatible) ──────────────────────
async function processWithDeepSeek(dialogContext: string): Promise<string> {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "deepseek-chat",
            messages: [
                { role: "system", content: ZETTELKASTEN_SYSTEM_PROMPT },
                { role: "user", content: dialogContext },
            ],
            temperature: 0.7,
            max_tokens: 2000,
        }),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`DeepSeek error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? "SKIP";
}

// ── Call GPT/Gemini/DeepSeek for Zettelkasten processing ─────
async function processWithAI(
    userText: string,
    assistantText: string,
    provider: "openai" | "google" | "deepseek",
): Promise<string> {
    const dialogContext = `Пользователь сказал:\n"${userText}"\n\nАссистент ответил:\n"${assistantText}"`;

    if (provider === "google" && GOOGLE_GEMINI_API_KEY) {
        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_GEMINI_API_KEY}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        system_instruction: {
                            parts: [{ text: ZETTELKASTEN_SYSTEM_PROMPT }],
                        },
                        contents: [
                            {
                                role: "user",
                                parts: [{ text: dialogContext }],
                            },
                        ],
                        generationConfig: {
                            temperature: 0.7,
                            maxOutputTokens: 2000,
                        },
                    }),
                },
            );

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`Gemini ${res.status}: ${errText}`);
            }

            const data = (await res.json()) as {
                candidates?: Array<{
                    content?: { parts?: Array<{ text?: string }> };
                }>;
            };
            return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "SKIP";
        } catch (geminiErr) {
            if (DEEPSEEK_API_KEY) {
                return processWithDeepSeek(dialogContext);
            }
            throw geminiErr;
        }
    }

    if (provider === "deepseek" && DEEPSEEK_API_KEY) {
        return processWithDeepSeek(dialogContext);
    }

    if (provider === "openai" && OPENAI_API_KEY) {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: ZETTELKASTEN_SYSTEM_PROMPT },
                    { role: "user", content: dialogContext },
                ],
                temperature: 0.7,
                max_tokens: 2000,
            }),
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`OpenAI error ${res.status}: ${errText}`);
        }

        const data = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
        };
        return data.choices?.[0]?.message?.content ?? "SKIP";
    }

    // Fallback
    if (DEEPSEEK_API_KEY) {
        return processWithDeepSeek(dialogContext);
    }

    throw new Error("No API key (DeepSeek/OpenAI/Google) available.");
}

// ── Route handler ────────────────────────────────────────────
export async function POST(req: NextRequest) {
    const raw: unknown = await req.json();
    const parsed = RequestSchema.safeParse(raw);

    if (!parsed.success) {
        return NextResponse.json(
            { error: "Invalid request", details: parsed.error.flatten() },
            { status: 400 },
        );
    }

    const { userText, assistantText, provider, userId } = parsed.data;

    try {
        // Save raw dialog to user's Archive folder (fire-and-forget)
        void appendToSessionArchive(userId, userText, assistantText);

        const aiResult = await processWithAI(userText, assistantText, provider);

        if (aiResult.trim() === "SKIP") {
            return NextResponse.json({ skipped: true, notes: 0 });
        }

        // Replace placeholders
        const now = new Date();
        const timestamp = makeTimestamp();
        const datetime = now.toISOString();
        const today = datetime.split("T")[0];

        const rawNotes = aiResult
            .split("---SPLIT---")
            .map((n) => n.trim())
            .filter(Boolean);

        const results: Array<{
            title: string;
            content: string;
            success: boolean;
            error?: string;
            method: string;
        }> = [];

        for (const raw of rawNotes) {
            const content = raw
                .replace(/\{\{date\}\}/g, today)
                .replace(/\{\{timestamp\}\}/g, timestamp)
                .replace(/\{\{datetime\}\}/g, datetime);

            const title = extractTitle(content);

            // Write note to user's Zettelkasten folder
            const writeResult = await writeNoteToVault(userId, title, content);
            results.push({
                title,
                content,
                success: writeResult.success,
                error: writeResult.error,
                method: writeResult.method,
            });
        }

        logger.info(`Obsidian [${userId}]: ${results.length} notes processed`);

        return NextResponse.json({
            skipped: false,
            notes: results.length,
            results,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unexpected error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
