import { NextRequest, NextResponse } from "next/server";
import { ChatRequestSchema } from "./types";
import { loadVaultContext, loadVaultNotes } from "@/lib/vaultContext";
import {
    saveMemory,
    searchMemories,
    getRecentMemories,
    preloadFromVault,
} from "@/lib/memoryStore";
import { writeNoteToVault } from "@/lib/vaultWriter";
import { classifyAndSave } from "@/lib/messageClassifier";
import { logger } from "@/lib/logger";
import { parseDSMLCalls, hasDSML, extractTextBeforeDSML } from "@/lib/parseDSML";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const LOCAL_CORE_URL = process.env.LOCAL_CORE_URL ?? "http://localhost:8000";

// ── ChromaDB RAG helper ──────────────────────────────────────
interface ChromaResult {
    id: string;
    text: string;
    metadata: Record<string, string>;
    distance: number;
    relevance_pct: number;
}

async function fetchChromaContext(query: string): Promise<string> {
    try {
        const res = await fetch(`${LOCAL_CORE_URL}/api/memory/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query,
                top_k: 3,
                source: "obsidian_vault",
            }),
            signal: AbortSignal.timeout(1500),
        });

        if (!res.ok) return "";

        const results = (await res.json()) as ChromaResult[];
        if (!results || results.length === 0) return "";

        const parts = ["--- РЕЛЕВАНТНЫЙ КОНТЕКСТ ИЗ ЗАМЕТОК (ChromaDB RAG) ---"];
        for (const r of results) {
            const title = r.metadata?.title ?? "без названия";
            parts.push(`• [${title}] (релевантность: ${r.relevance_pct}%) ${r.text.slice(0, 300)}`);
        }
        parts.push("--- КОНЕЦ КОНТЕКСТА ---");
        return parts.join("\n");
    } catch {
        // Local core offline — silent fallback
        return "";
    }
}

// ── Function calling tools ────────────────────────────────────
const MEMORY_TOOLS = [
    {
        type: "function" as const,
        function: {
            name: "save_memory",
            description:
                "ОБЯЗАТЕЛЬНО вызывай эту функцию когда пользователь делится ЛЮБОЙ личной информацией: имена, клички питомцев, даты рождения, предпочтения, привычки, цели, события, здоровье, отношения, работа, хобби. Сохраняй ВСЮ информацию без исключений.",
            parameters: {
                type: "object",
                properties: {
                    text: {
                        type: "string",
                        description:
                            "Краткая суть того что нужно запомнить (1-2 предложения)",
                    },
                    tags: {
                        type: "array",
                        items: { type: "string" },
                        description:
                            "Теги для категоризации: preference, fact, goal, person, habit, event, idea",
                    },
                },
                required: ["text", "tags"],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "search_memory",
            description:
                "Поиск в памяти по запросу. Используй когда пользователь спрашивает что ты помнишь о нём, или когда нужно найти ранее сохранённую информацию.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "Поисковый запрос",
                    },
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "create_zettel",
            description:
                "Создать структурированную заметку Zettelkasten в Obsidian. Используй когда пользователь делится идеей, инсайтом, фактом или задачей которые стоит оформить как атомарную заметку.",
            parameters: {
                type: "object",
                properties: {
                    title: {
                        type: "string",
                        description:
                            "Декларативный заголовок-утверждение (НЕ существительное, а полная мысль). Пример: 'Прокрастинация возникает из-за страха неудачи, а не лени'",
                    },
                    essence: {
                        type: "string",
                        description: "Суть идеи — переформулированная мысль пользователя, понятная без контекста",
                    },
                    action: {
                        type: "string",
                        description: "Практическое применение: как использовать эту идею в действиях",
                    },
                    tags: {
                        type: "array",
                        items: { type: "string" },
                        description: "Теги для категоризации, например: #идея, #продуктивность, #здоровье",
                    },
                    compass: {
                        type: "object",
                        properties: {
                            north: { type: "string", description: "Более широкая тема/паттерн" },
                            south: { type: "string", description: "Корневая причина / детали" },
                            east: { type: "string", description: "Контраргумент / противоречие" },
                            west: { type: "string", description: "Аналогия из другой области" },
                        },
                        required: ["north", "south", "east", "west"],
                    },
                    context: {
                        type: "string",
                        description: "Контекст диалога: в каком разговоре возникла эта мысль",
                    },
                    noteType: {
                        type: "string",
                        enum: ["idea", "fact", "task", "persona"],
                        description: "Тип заметки",
                    },
                },
                required: ["title", "essence", "action", "tags", "compass", "context", "noteType"],
            },
        },
    },
];

// ── Build memory context ──────────────────────────────────────
async function buildMemoryContext(
    userId: string,
    userMessage: string,
): Promise<string> {
    const parts: string[] = [];

    // 1. Recent memories (preload)
    const recent = await getRecentMemories(userId, 20);
    if (recent.length > 0) {
        parts.push("--- ДОЛГОВРЕМЕННАЯ ПАМЯТЬ (последние воспоминания) ---");
        for (const mem of recent) {
            const date = new Date(mem.createdAt).toLocaleDateString("ru-RU");
            const tags = mem.tags.length > 0 ? ` [${mem.tags.join(", ")}]` : "";
            parts.push(`• ${mem.text}${tags} (${date})`);
        }
        parts.push("--- КОНЕЦ ПАМЯТИ ---");
    }

    // 2. Semantic search for relevant memories
    const relevant = await searchMemories(userId, userMessage);
    if (relevant.length > 0) {
        // Deduplicate with recent
        const recentIds = new Set(recent.map((m) => m.id));
        const unique = relevant.filter(
            (r) => !recentIds.has(r.memory.id),
        );

        if (unique.length > 0) {
            parts.push(
                "\n--- РЕЛЕВАНТНЫЕ ВОСПОМИНАНИЯ (по запросу) ---",
            );
            for (const { memory, score } of unique) {
                const date = new Date(memory.createdAt).toLocaleDateString(
                    "ru-RU",
                );
                parts.push(
                    `• ${memory.text} [${memory.tags.join(", ")}] (${date}, релевантность: ${(score * 100).toFixed(0)}%)`,
                );
            }
            parts.push("--- КОНЕЦ РЕЛЕВАНТНЫХ ---");
        }
    }

    return parts.join("\n");
}

// ── Handle function calls ─────────────────────────────────────
interface ToolCall {
    id: string;
    function: {
        name: string;
        arguments: string;
    };
}

async function handleToolCalls(
    userId: string,
    toolCalls: ToolCall[],
): Promise<Array<{ role: string; tool_call_id: string; content: string }>> {
    const results: Array<{
        role: string;
        tool_call_id: string;
        content: string;
    }> = [];

    for (const tc of toolCalls) {
        try {
            const args = JSON.parse(tc.function.arguments) as Record<
                string,
                unknown
            >;

            if (tc.function.name === "save_memory") {
                const text = args.text as string;
                const tags = (args.tags as string[]) ?? [];
                const memory = await saveMemory(userId, text, tags);
                results.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    content: JSON.stringify({
                        success: true,
                        id: memory.id,
                        text: memory.text,
                    }),
                });
                logger.debug(`Memory saved via function call: "${text.slice(0, 50)}"`);
            } else if (tc.function.name === "search_memory") {
                const query = args.query as string;
                const found = await searchMemories(userId, query);
                results.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    content: JSON.stringify({
                        results: found.map((r) => ({
                            text: r.memory.text,
                            tags: r.memory.tags,
                            date: r.memory.createdAt,
                            relevance: `${(r.score * 100).toFixed(0)}%`,
                        })),
                    }),
                });
                logger.debug(
                    `Memory search: "${query}" → ${found.length} results`,
                );
            } else if (tc.function.name === "create_zettel") {
                const title = args.title as string;
                const essence = args.essence as string;
                const action = args.action as string;
                const tags = (args.tags as string[]) ?? [];
                const compass = args.compass as { north: string; south: string; east: string; west: string };
                const context = args.context as string;
                const noteType = args.noteType as string;

                const now = new Date();
                const timestamp = now.toISOString().replace(/[-T:.Z]/g, "").slice(0, 14);
                const dateStr = now.toISOString().split("T")[0];

                const TYPE_EMOJI: Record<string, string> = { idea: "💡", fact: "📚", task: "✅", persona: "👤" };
                const emoji = TYPE_EMOJI[noteType] ?? "💡";

                const markdown = `---
type: ${noteType}
tags: [${tags.map((t) => `"${t}"`).join(", ")}]
created: ${now.toISOString()}
compass: ["${compass.north}", "${compass.south}", "${compass.east}", "${compass.west}"]
---

# ${title}

${emoji} **Суть идеи**
${essence}

🛠 **Практическое применение**
${action}

🧭 **Компас Идей**
- **Север** (тема): [[${compass.north}]]
- **Юг** (причины): [[${compass.south}]]
- **Восток** (контраргументы): [[${compass.east}]]
- **Запад** (аналогии): [[${compass.west}]]

🎙 **Контекст**
> ${context}
`;

                const safeTitle = title.replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 100);
                const fileName = `${safeTitle}`;

                const writeResult = await writeNoteToVault(userId, fileName, markdown);

                // Also save to memory
                await saveMemory(userId, `Zettel: ${title} — ${essence.slice(0, 100)}`, ["zettel", noteType, ...tags.map((t) => t.replace("#", ""))]);

                results.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    content: JSON.stringify({
                        success: writeResult.success,
                        title: safeTitle,
                        method: writeResult.method,
                        error: writeResult.error,
                    }),
                });

                logger.debug(`Zettel created: "${safeTitle}" [${noteType}] via ${writeResult.method}`);
            }
        } catch (err) {
            results.push({
                role: "tool",
                tool_call_id: tc.id,
                content: JSON.stringify({
                    error:
                        err instanceof Error ? err.message : "Unknown error",
                }),
            });
        }
    }

    return results;
}

// ── OpenAI with function calling (non-streaming first pass) ──
async function callOpenAIWithTools(
    userId: string,
    messages: Array<{ role: string; content: string }>,
    systemPrompt: string,
): Promise<{
    finalMessages: Array<Record<string, unknown>>;
    needsStream: boolean;
}> {
    const apiMessages: Array<Record<string, unknown>> = [
        { role: "system", content: systemPrompt },
        ...messages,
    ];

    // First call: check if AI wants to call tools
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: apiMessages,
            tools: MEMORY_TOOLS,
            tool_choice: "auto",
        }),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenAI error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as {
        choices?: Array<{
            message?: {
                role?: string;
                content?: string | null;
                tool_calls?: ToolCall[];
            };
            finish_reason?: string;
        }>;
    };

    const choice = data.choices?.[0];
    const assistantMessage = choice?.message;

    if (choice?.finish_reason === "tool_calls" && assistantMessage?.tool_calls) {
        // Execute tool calls
        const toolResults = await handleToolCalls(userId, assistantMessage.tool_calls);

        // Add assistant message with tool calls + tool results
        apiMessages.push({
            role: "assistant",
            content: assistantMessage.content ?? null,
            tool_calls: assistantMessage.tool_calls,
        });

        for (const result of toolResults) {
            apiMessages.push(result);
        }

        return { finalMessages: apiMessages, needsStream: true };
    }

    // No tool calls — but we already got a response, need to re-stream
    return { finalMessages: apiMessages, needsStream: true };
}

// ── OpenAI streaming ─────────────────────────────────────────
async function streamOpenAI(
    messages: Array<Record<string, unknown>>,
): Promise<ReadableStream<Uint8Array>> {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "gpt-4o-mini",
            stream: true,
            stream_options: { include_usage: true },
            messages,
        }),
    });

    if (!res.ok || !res.body) {
        const errText = await res.text();
        throw new Error(`OpenAI error ${res.status}: ${errText}`);
    }

    return res.body;
}

// ── DeepSeek streaming (OpenAI-compatible) ───────────────────
async function streamDeepSeek(
    messages: Array<Record<string, unknown>>,
): Promise<ReadableStream<Uint8Array>> {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "deepseek-chat",
            stream: true,
            stream_options: { include_usage: true },
            messages,
        }),
    });

    if (!res.ok || !res.body) {
        const errText = await res.text();
        throw new Error(`DeepSeek error ${res.status}: ${errText}`);
    }

    return res.body;
}

// ── DeepSeek with function calling (non-streaming first pass) ──
async function callDeepSeekWithTools(
    userId: string,
    messages: Array<{ role: string; content: string }>,
    systemPrompt: string,
): Promise<{
    finalMessages: Array<Record<string, unknown>>;
    needsStream: boolean;
}> {
    const apiMessages: Array<Record<string, unknown>> = [
        { role: "system", content: systemPrompt },
        ...messages,
    ];

    // First call: check if AI wants to call tools
    const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "deepseek-chat",
            messages: apiMessages,
            tools: MEMORY_TOOLS,
            tool_choice: "auto",
        }),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`DeepSeek error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as {
        choices?: Array<{
            message?: {
                role?: string;
                content?: string | null;
                tool_calls?: ToolCall[];
            };
            finish_reason?: string;
        }>;
    };

    const choice = data.choices?.[0];
    const assistantMessage = choice?.message;

    logger.info(`DeepSeek tools: finish_reason=${choice?.finish_reason}, tool_calls=${assistantMessage?.tool_calls?.length ?? 0}, content=${(assistantMessage?.content ?? "").slice(0, 100)}`);

    if (
        (choice?.finish_reason === "tool_calls" || assistantMessage?.tool_calls?.length) &&
        assistantMessage?.tool_calls
    ) {
        // Execute tool calls
        const toolResults = await handleToolCalls(userId, assistantMessage.tool_calls);

        // Add assistant message with tool calls + tool results
        apiMessages.push({
            role: "assistant",
            content: assistantMessage.content ?? null,
            tool_calls: assistantMessage.tool_calls,
        });

        for (const result of toolResults) {
            apiMessages.push(result);
        }

        return { finalMessages: apiMessages, needsStream: true };
    }

    // No tool calls — re-stream
    return { finalMessages: apiMessages, needsStream: true };
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
                    const part =
                        parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (part) {
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
// ── Append classification counter tags to SSE stream ─────────
function appendCounterTags(
    baseStream: ReadableStream<Uint8Array>,
    classifyPromise: Promise<{ counterTags: string[] }>,
    userId?: string,
): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    return new ReadableStream<Uint8Array>({
        async start(controller) {
            const reader = baseStream.getReader();
            let rawBuffer = "";
            const collectedParts: string[] = []; // All SSE parts buffered
            let fullContent = "";

            // 1. Collect ALL chunks — do NOT emit anything yet
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    rawBuffer += decoder.decode(value, { stream: true });

                    const parts = rawBuffer.split("\n\n");
                    rawBuffer = parts.pop() ?? "";

                    for (const part of parts) {
                        const trimmed = part.trim();
                        if (!trimmed || trimmed === "data: [DONE]") continue;
                        collectedParts.push(trimmed);

                        // Track full content
                        if (trimmed.startsWith("data: ")) {
                            try {
                                const json = JSON.parse(trimmed.slice(6)) as {
                                    choices?: Array<{ delta?: { content?: string } }>;
                                };
                                const c = json.choices?.[0]?.delta?.content;
                                if (c) fullContent += c;
                            } catch { /* */ }
                        }
                    }
                }
                // Flush remaining
                if (rawBuffer.trim() && rawBuffer.trim() !== "data: [DONE]") {
                    collectedParts.push(rawBuffer.trim());
                    if (rawBuffer.trim().startsWith("data: ")) {
                        try {
                            const json = JSON.parse(rawBuffer.trim().slice(6)) as {
                                choices?: Array<{ delta?: { content?: string } }>;
                            };
                            const c = json.choices?.[0]?.delta?.content;
                            if (c) fullContent += c;
                        } catch { /* */ }
                    }
                }
            } catch {
                // stream interrupted
            }

            // 2. Check for DSML in the FULL collected content
            const containsDSML = hasDSML(fullContent);

            if (containsDSML) {
                // --- DSML detected: extract clean text, execute functions, emit friendly ---
                const cleanText = extractTextBeforeDSML(fullContent);

                // Emit clean text portion (if any) as a single chunk
                if (cleanText.length > 0) {
                    const chunk = JSON.stringify({
                        choices: [{ delta: { content: cleanText }, index: 0 }],
                    });
                    controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
                }

                // Execute DSML function calls
                if (userId) {
                    const calls = parseDSMLCalls(fullContent);
                    const friendlyParts: string[] = [];

                    for (const call of calls) {
                        try {
                            if (call.name === "create_zettel") {
                                const cTitle = call.params.title || "Без названия";
                                const cContent = call.params.content || call.params.essence || "";
                                const cNoteType = call.params.noteType || "fact";
                                const cTags = call.params.tags ? call.params.tags.split(",").map((t: string) => t.trim()) : [];
                                const now = new Date();
                                const TYPE_EMOJI: Record<string, string> = { idea: "💡", fact: "📚", task: "✅", persona: "👤" };
                                const emoji = TYPE_EMOJI[cNoteType] ?? "📚";
                                const md = `---\ntype: ${cNoteType}\ntags: [${cTags.map((t: string) => `"${t}"`).join(", ")}]\ncreated: ${now.toISOString()}\n---\n\n# ${cTitle}\n\n${emoji} **Суть**\n${cContent}\n`;
                                const safeTitle = cTitle.replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 100);
                                await writeNoteToVault(userId, safeTitle, md);
                                await saveMemory(userId, `Zettel: ${cTitle} — ${cContent.slice(0, 100)}`, ["zettel", cNoteType]);
                                friendlyParts.push(`📝 Заметка «${safeTitle}» создана!`);
                                logger.info(`[DSML] Created zettel: ${safeTitle}`);
                            } else if (call.name === "save_memory") {
                                const mText = call.params.text || call.params.content || "";
                                if (mText) {
                                    await saveMemory(userId, mText, ["chat"]);
                                    friendlyParts.push("💾 Запомнил!");
                                    logger.info(`[DSML] Saved memory: ${mText.slice(0, 50)}`);
                                }
                            } else if (call.name === "search_memory") {
                                const sQuery = call.params.query || "";
                                if (sQuery) {
                                    const results = await searchMemories(userId, sQuery);
                                    if (results.length > 0) {
                                        friendlyParts.push(`🔍 Нашёл ${results.length} воспоминаний о «${sQuery}»`);
                                    }
                                    logger.info(`[DSML] Search: ${sQuery} → ${results.length}`);
                                }
                            }
                        } catch (err) {
                            logger.error(`[DSML] Error executing ${call.name}:`, (err as Error).message);
                        }
                    }

                    if (friendlyParts.length > 0) {
                        const fChunk = JSON.stringify({
                            choices: [{ delta: { content: friendlyParts.join(" ") }, index: 0 }],
                        });
                        controller.enqueue(encoder.encode(`data: ${fChunk}\n\n`));
                    }
                }
            } else {
                // --- No DSML: replay all buffered chunks normally ---
                for (const part of collectedParts) {
                    controller.enqueue(encoder.encode(part + "\n\n"));
                }
            }

            // Append counter tags if any
            try {
                const result = await classifyPromise;
                if (result.counterTags.length > 0) {
                    const tagStr = " " + result.counterTags.join(" ");
                    const chunk = JSON.stringify({
                        choices: [{ delta: { content: tagStr }, index: 0 }],
                    });
                    controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
                }
            } catch {
                // classifier failed
            }

            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
        },
    });
}

export async function POST(req: NextRequest) {
    const raw: unknown = await req.json();
    const parsed = ChatRequestSchema.safeParse(raw);

    if (!parsed.success) {
        return NextResponse.json(
            { error: "Invalid request", details: parsed.error.flatten() },
            { status: 400 },
        );
    }

    const { messages, provider, systemPrompt, userId, source } = parsed.data;
    const isVoice = source === "voice";

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
        // Load vault context (cached, ~30K chars of existing notes)
        const vaultContext = await loadVaultContext(userId);

        // Load memory context (recent + semantic search)
        const lastUserMsg = [...messages]
            .reverse()
            .find((m) => m.role === "user");
        const memoryContext = await buildMemoryContext(
            userId,
            lastUserMsg?.content ?? "",
        );

        // Build enriched system prompt
        let enrichedPrompt = systemPrompt ?? "";

        // Preload vault notes into memory store (first time only)
        const memCount = await getRecentMemories(userId, 1);
        if (memCount.length === 0) {
            const vaultNotes = await loadVaultNotes(userId);
            if (vaultNotes.length > 0) {
                await preloadFromVault(userId, vaultNotes.slice(0, 50));
            }
        }

        if (isVoice) {
            // Voice mode: simple prompt without any tool/zettel instructions
            enrichedPrompt += `\n\n## ПРАВИЛА ДЛЯ ГОЛОСА:\n- Отвечай КРАТКО (1-3 предложения).\n- НЕ используй маркировку, списки, emoji — только чистый текст для озвучки.\n- НЕ вызывай функции, НЕ пиши XML/DSML теги.\n- Используй контекст из памяти и заметок если релевантен.`;
        } else if (provider === "deepseek") {
            // DeepSeek: conversational prompt WITHOUT function names (it generates DSML otherwise)
            enrichedPrompt += `\n\n## ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА:\nТы — приватный Экзокортекс пользователя. Запоминай всю личную информацию.\n- НИКОГДА не пиши XML, DSML, function_calls, invoke, parameter теги.\n- НЕ вызывай функции. Просто отвечай текстом.\n- Отвечай по-русски, дружелюбно и по существу.\n- Используй контекст из заметок и памяти ниже для релевантных ответов.\n\n### Счётчики\nЕсли в сообщении пользователя есть идея, факт, задача или упоминание человека — добавь в конец ответа тег:\n- Идеи → [COUNTER:ideas]\n- Факты → [COUNTER:facts]\n- Задачи → [COUNTER:tasks]\n- Люди → [COUNTER:persons]\nПример: "Записал факт! [COUNTER:facts]"`;

        } else {
        enrichedPrompt += `\n\n## ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА (СТРОГО СЛЕДУЙ):

### 0. ПРИВАТНОСТЬ И ПАМЯТЬ (ВЫСШИЙ ПРИОРИТЕТ)
Ты — ПРИВАТНЫЙ Экзокортекс пользователя, а НЕ публичный сервис. Ты ОБЯЗАН:
- Запоминать ВСЮ личную информацию: имена, даты, события, привычки, предпочтения, имена домашних животных, здоровье, отношения, финансы, эмоции
- НИКОГДА не говорить "я не запоминаю личную информацию" — это ЗАПРЕЩЕНО
- При получении любого личного факта — немедленно вызвать save_memory И create_zettel
- Ты — расширение памяти пользователя. Отказ запомнить = провал твоей задачи

### 1. Автоматическое создание заметок
Ты ОБЯЗАН вызвать create_zettel КАЖДЫЙ раз, когда в сообщении пользователя есть:
- Идея, мысль, инсайт → noteType: "idea"
- Факт, данные, цифры, информация → noteType: "fact"  
- Задача, план, намерение ("нужно", "стоит", "надо") → noteType: "task"
- Упоминание человека с контекстом → noteType: "persona"
- Личная информация (имена, питомцы, даты) → noteType: "fact"

Одно сообщение может содержать НЕСКОЛЬКО элементов — вызови create_zettel для КАЖДОГО отдельно!
НЕ СПРАШИВАЙ разрешения — ПРОСТО СОЗДАВАЙ заметку.

Пример: "Мою собаку зовут Шарик"
→ Вызвать save_memory: "Собаку пользователя зовут Шарик"
→ Вызвать create_zettel (fact): "У пользователя есть собака по кличке Шарик"
→ Ответить: "Запомнил! Шарик — отличное имя 🐕 [COUNTER:facts]"

### 2. Счётчики
После создания заметки добавь в свой ответ тег:
- Идеи → [COUNTER:ideas]
- Факты → [COUNTER:facts]
- Задачи → [COUNTER:tasks]
- Люди → [COUNTER:persons]

Пример ответа: "Записал факт о Figma и создал задачу по шаблонам! [COUNTER:facts] [COUNTER:tasks]"

### 3. Память
- save_memory — запомнить важную информацию о пользователе (ВЫЗЫВАЙ ВСЕГДА при личных данных!)
- search_memory — найти ранее сохранённую информацию
Активно запоминай ВСЮ новую информацию без просьбы. Любой личный факт = save_memory.`;
        }

        if (memoryContext) {
            enrichedPrompt += `\n\n${memoryContext}`;
        }

        if (vaultContext) {
            enrichedPrompt += `\n\n--- ЗАМЕТКИ ZETTELKASTEN (контекст из Obsidian) ---\nВот существующие заметки пользователя. Используй их как контекст для более релевантных ответов. Если пользователь спрашивает о чём-то связанном — ссылайся на эти заметки.\n${vaultContext}\n--- КОНЕЦ ЗАМЕТОК ---`;
        }

        // ── ChromaDB RAG context (local_core vector search) ──
        const userQuery = lastUserMsg?.content ?? "";
        if (userQuery.length > 3) {
            const chromaContext = await fetchChromaContext(userQuery);
            if (chromaContext) {
                enrichedPrompt += `\n\n${chromaContext}`;
            }
        }

        // ── Auto-save user message to memory (fire-and-forget) ──
        const lastUserMsgForMem = messages
            .filter((m) => m.role === "user")
            .pop();
        if (lastUserMsgForMem && lastUserMsgForMem.content.trim().length > 10) {
            saveMemory(
                userId,
                `Пользователь написал: ${lastUserMsgForMem.content.slice(0, 300)}`,
                ["chat", "user-said"],
            ).catch(() => { /* silent */ });
        }

        // Get the last user message for classification
        const classifyMsg = messages
            .filter((m) => m.role === "user")
            .pop();
        const classifyPromise = classifyMsg
            ? classifyAndSave(userId, classifyMsg.content)
            : Promise.resolve({ items: [], counterTags: [] });

        if (provider === "google") {
            try {
                const baseStream = await streamGemini(messages, enrichedPrompt);
                const taggedStream = appendCounterTags(baseStream, classifyPromise, userId);
                return new Response(taggedStream, {
                    headers: {
                        "Content-Type": "text/event-stream",
                        "Cache-Control": "no-cache",
                        Connection: "keep-alive",
                    },
                });
            } catch (geminiErr) {
                // Fallback to DeepSeek if Gemini quota exceeded (429)
                const errMsg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
                logger.warn(`Gemini failed: ${errMsg.slice(0, 100)}`);
                if (DEEPSEEK_API_KEY) {
                    logger.warn("Falling back to DeepSeek...");
                    const gdsPrompt = enrichedPrompt.replace(/save_memory|search_memory|create_zettel|tool_choice/gi, "").replace(/вызвать\s+\w+/gi, "запомнить");
                    const simpleMessages = [
                        { role: "system", content: gdsPrompt },
                        ...messages.map((m) => ({ role: m.role, content: m.content })),
                    ];
                    const baseStream = await streamDeepSeek(simpleMessages as Array<Record<string, unknown>>);
                    const taggedStream = appendCounterTags(baseStream, classifyPromise, userId);
                    return new Response(taggedStream, {
                        headers: {
                            "Content-Type": "text/event-stream",
                            "Cache-Control": "no-cache",
                            Connection: "keep-alive",
                        },
                    });
                }
                throw geminiErr;
            }
        }

        if (provider === "deepseek") {
            // DeepSeek: always stream directly (no tools — it outputs DSML text instead)
            const finalMsgs: Array<Record<string, unknown>> = [
                { role: "system", content: enrichedPrompt },
                ...messages.map((m) => ({ role: m.role, content: m.content })),
            ];
            const baseStream = await streamDeepSeek(finalMsgs);
            const taggedStream = appendCounterTags(baseStream, classifyPromise, userId);
            return new Response(taggedStream, {
                headers: {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    Connection: "keep-alive",
                },
            });
        }

        // OpenAI path
        try {
            let finalMsgs: Array<Record<string, unknown>>;
            if (isVoice) {
                // Voice mode: skip tools, stream directly
                finalMsgs = [
                    { role: "system", content: enrichedPrompt },
                    ...messages.map((m) => ({ role: m.role, content: m.content })),
                ];
            } else {
                // Text mode: first pass with function calling
                const { finalMessages } = await callOpenAIWithTools(
                    userId,
                    messages,
                    enrichedPrompt,
                );
                finalMsgs = finalMessages;
            }

            const baseStream = await streamOpenAI(finalMsgs);
            const taggedStream = appendCounterTags(baseStream, classifyPromise, userId);

            return new Response(taggedStream, {
                headers: {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    Connection: "keep-alive",
                },
            });
        } catch (openaiErr) {
            // ── Fallback chain if OpenAI is blocked (403/country) ──
            const errMsg = openaiErr instanceof Error ? openaiErr.message : "";
            const isBlocked = errMsg.includes("403") || errMsg.includes("unsupported_country");

            if (!isBlocked) throw openaiErr;

            // Fallback 1: DeepSeek (works without VPN from Russia)
            if (DEEPSEEK_API_KEY) {
                try {
                    logger.warn("OpenAI blocked (403), falling back to DeepSeek");
                    // Strip tool instructions (DeepSeek generates DSML otherwise)
                    const dsPrompt = enrichedPrompt.replace(/save_memory|search_memory|create_zettel|tool_choice/gi, "").replace(/вызвать\s+\w+/gi, "запомнить");
                    const simpleMessages = [
                        { role: "system", content: dsPrompt },
                        ...messages.map((m) => ({ role: m.role, content: m.content })),
                    ];
                    const baseStream = await streamDeepSeek(simpleMessages as Array<Record<string, unknown>>);
                    const taggedStream = appendCounterTags(baseStream, classifyPromise, userId);
                    return new Response(taggedStream, {
                        headers: {
                            "Content-Type": "text/event-stream",
                            "Cache-Control": "no-cache",
                            Connection: "keep-alive",
                        },
                    });
                } catch (deepseekErr) {
                    logger.warn("DeepSeek also failed:", (deepseekErr as Error).message);
                }
            }

            // Fallback 2: Gemini
            if (GOOGLE_GEMINI_API_KEY) {
                logger.warn("Falling back to Gemini");
                const baseStream = await streamGemini(messages, enrichedPrompt);
                const taggedStream = appendCounterTags(baseStream, classifyPromise, userId);
                return new Response(taggedStream, {
                    headers: {
                        "Content-Type": "text/event-stream",
                        "Cache-Control": "no-cache",
                        Connection: "keep-alive",
                    },
                });
            }

            throw openaiErr; // no fallback available
        }
    } catch (err) {
        const message =
            err instanceof Error ? err.message : "Unexpected error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
