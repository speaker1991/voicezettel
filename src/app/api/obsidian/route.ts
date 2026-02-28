import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
const OBSIDIAN_REST_URL = process.env.OBSIDIAN_REST_URL;
const OBSIDIAN_API_KEY = process.env.OBSIDIAN_API_KEY;
const VAULT_PATH = process.env.VAULT_PATH;

// ── Request schema ───────────────────────────────────────────
const RequestSchema = z.object({
    userText: z.string().min(1),
    assistantText: z.string().min(1),
    provider: z.enum(["openai", "google"]).default("openai"),
    hasLocalApi: z.boolean().default(false),
});

// ── Zettelkasten system prompt ──────────────────────────────
const ZETTELKASTEN_SYSTEM_PROMPT = `Ты — система обработки заметок Zettelkasten. Твоя задача — преобразовать диалог пользователя в атомарные заметки.

ПРАВИЛА:
- Атомарность (Atomicity): Одна идея = одна заметка. Если в монологе прозвучало три разные мысли, создай три отдельные сущности. Каждая заметка должна быть как кирпичик LEGO.
- Автономность (Autonomy): Переписывай сырую речь так, чтобы идея была абсолютно понятна без контекста сегодняшнего диалога (пиши для будущего «я», которое всё забыло).
- Заголовок должен быть не просто существительным (например, «Прокрастинация»), а полным декларативным утверждением (например, «Прокрастинация возникает из-за страха неудачи, а не лени»).
- Практическая польза (Productive Thinking): Каждая концепция должна перекидывать мост между теорией и ежедневными действиями.

ФОРМАТ ОТВЕТА — чистый Markdown для КАЖДОЙ заметки:

---
id: "{{timestamp}}"
title: "{{title}}"
type: zettel
tags: [добавь 2-3 тега по темам]
source: voice-dialog
created: "{{datetime}}"
---

# [Декларативный заголовок-утверждение]

[Переформулируй мысль максимально ясно, емко и глубоко. 3-5 предложений.]

## Практическое применение
[Конкретное действие или ментальная установка.]

## Связи
- [[MOC — ...]] (к какой теме относится)
- [[...]] (связанные концепты)

---

Если в тексте несколько идей — выдай несколько заметок, разделённых строкой "---SPLIT---".
Замени {{timestamp}} на текущий timestamp (YYYYMMDDHHmmss), {{title}} на заголовок, {{datetime}} на ISO дату.
Отвечай ТОЛЬКО Markdown-кодом заметок, без пояснений.
Если в тексте нет ценных идей (просто приветствие, бытовой вопрос) — ответь словом "SKIP".`;

// ── Extract title from markdown ──────────────────────────────
function extractTitle(markdown: string): string {
    // Try frontmatter title first
    const fmMatch = /^title:\s*"?(.+?)"?\s*$/m.exec(markdown);
    if (fmMatch) {
        return fmMatch[1].replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 100);
    }
    // Try heading
    const hMatch = /^#\s+(.+)$/m.exec(markdown);
    if (hMatch) {
        return hMatch[1].replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 100);
    }
    return `Zettel-${Date.now()}`;
}

// ── Generate timestamp ID ────────────────────────────────────
function makeTimestamp(): string {
    const now = new Date();
    return now
        .toISOString()
        .replace(/[-T:.Z]/g, "")
        .slice(0, 14);
}

// ── Write note to vault ──────────────────────────────────────
async function writeNoteToVault(
    title: string,
    content: string,
): Promise<{ success: boolean; error?: string; method: string }> {
    const filename = `${title}.md`;

    // Method 1: Direct filesystem write (fastest, most reliable)
    if (VAULT_PATH) {
        try {
            const zettelDir = join(VAULT_PATH, "10_Zettels");
            await mkdir(zettelDir, { recursive: true });
            const filePath = join(zettelDir, filename);
            await writeFile(filePath, content, "utf-8");
            return { success: true, method: "filesystem" };
        } catch (err) {
            // Fall through to REST API
            const fsErr = err instanceof Error ? err.message : "Unknown";
            // Try REST API as fallback
            if (OBSIDIAN_REST_URL && OBSIDIAN_API_KEY) {
                const restResult = await writeViaRestApi(filename, content);
                if (restResult.success) return restResult;
            }
            return { success: false, error: fsErr, method: "filesystem" };
        }
    }

    // Method 2: REST API
    if (OBSIDIAN_REST_URL && OBSIDIAN_API_KEY) {
        return writeViaRestApi(filename, content);
    }

    return {
        success: false,
        error: "No VAULT_PATH or OBSIDIAN_REST_URL configured",
        method: "none",
    };
}

async function writeViaRestApi(
    filename: string,
    content: string,
): Promise<{ success: boolean; error?: string; method: string }> {
    const path = `10_Zettels/${filename}`;
    const url = `${OBSIDIAN_REST_URL}/vault/${encodeURIComponent(path)}`;

    try {
        const res = await fetch(url, {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${OBSIDIAN_API_KEY}`,
                "Content-Type": "text/markdown",
            },
            body: content,
        });

        if (!res.ok) {
            const errText = await res.text();
            return {
                success: false,
                error: `REST API ${res.status}: ${errText}`,
                method: "rest-api",
            };
        }

        return { success: true, method: "rest-api" };
    } catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : "Network error",
            method: "rest-api",
        };
    }
}

// ── Call GPT/Gemini for Zettelkasten processing ──────────────
async function processWithAI(
    userText: string,
    assistantText: string,
    provider: "openai" | "google",
): Promise<string> {
    const dialogContext = `Пользователь сказал: "${userText}"\n\nОтвет ассистента: "${assistantText}"`;

    if (provider === "google" && GOOGLE_GEMINI_API_KEY) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_GEMINI_API_KEY}`;
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [
                    { role: "user", parts: [{ text: dialogContext }] },
                ],
                systemInstruction: {
                    parts: [{ text: ZETTELKASTEN_SYSTEM_PROMPT }],
                },
                generationConfig: { temperature: 0.7 },
            }),
        });

        if (!res.ok) throw new Error(`Gemini error ${res.status}`);

        const data = (await res.json()) as {
            candidates?: Array<{
                content?: { parts?: Array<{ text?: string }> };
            }>;
        };
        return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "SKIP";
    }

    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

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
        }),
    });

    if (!res.ok) throw new Error(`OpenAI error ${res.status}`);

    const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? "SKIP";
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

    const { userText, assistantText, provider, hasLocalApi } = parsed.data;

    try {
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

            // Only write to server vault if user does NOT have their own local Obsidian
            if (!hasLocalApi) {
                const result = await writeNoteToVault(title, content);
                results.push({ title, content, ...result });
            } else {
                // Return notes for client-side PUT (no server write)
                results.push({ title, content, success: true, method: "client" });
            }
        }

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
