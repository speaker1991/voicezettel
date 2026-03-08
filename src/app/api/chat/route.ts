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

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// ── Function calling tools ────────────────────────────────────
const MEMORY_TOOLS = [
    {
        type: "function" as const,
        function: {
            name: "save_memory",
            description:
                "Сохранить важную информацию о пользователе в долговременную память. Используй когда пользователь делится личными предпочтениями, фактами о себе, своими целями, привычками, важными событиями или просит запомнить что-то.",
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

                const writeResult = await writeNoteToVault(fileName, markdown);

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
): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    return new ReadableStream<Uint8Array>({
        async start(controller) {
            const reader = baseStream.getReader();
            let buffer = "";

            // Pipe base stream through, intercepting [DONE]
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    // Decode chunk, check for [DONE]
                    const text = decoder.decode(value, { stream: true });
                    buffer += text;

                    // Split into complete SSE messages
                    const parts = buffer.split("\n\n");
                    buffer = parts.pop() ?? "";

                    for (const part of parts) {
                        const trimmed = part.trim();
                        if (trimmed === "data: [DONE]") continue; // skip, we'll add our own
                        if (trimmed) {
                            controller.enqueue(encoder.encode(trimmed + "\n\n"));
                        }
                    }
                }

                // Flush remaining buffer (except [DONE])
                if (buffer.trim() && buffer.trim() !== "data: [DONE]") {
                    controller.enqueue(encoder.encode(buffer));
                }
            } catch {
                // stream interrupted
            }

            // After main stream ends, append counter tags if any
            try {
                const result = await classifyPromise;
                if (result.counterTags.length > 0) {
                    const tagStr = " " + result.counterTags.join(" ");
                    const chunk = JSON.stringify({
                        choices: [
                            { delta: { content: tagStr }, index: 0 },
                        ],
                    });
                    controller.enqueue(
                        encoder.encode(`data: ${chunk}\n\n`),
                    );
                }
            } catch {
                // classifier failed — no tags, no problem
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

    const { messages, provider, systemPrompt, userId } = parsed.data;

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
        const vaultContext = await loadVaultContext();

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
            const vaultNotes = await loadVaultNotes();
            if (vaultNotes.length > 0) {
                await preloadFromVault(userId, vaultNotes.slice(0, 50));
            }
        }

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

        if (memoryContext) {
            enrichedPrompt += `\n\n${memoryContext}`;
        }

        if (vaultContext) {
            enrichedPrompt += `\n\n--- ЗАМЕТКИ ZETTELKASTEN (контекст из Obsidian) ---\nВот существующие заметки пользователя. Используй их как контекст для более релевантных ответов. Если пользователь спрашивает о чём-то связанном — ссылайся на эти заметки.\n${vaultContext}\n--- КОНЕЦ ЗАМЕТОК ---`;
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
                const taggedStream = appendCounterTags(baseStream, classifyPromise);
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
                    const simpleMessages = [
                        { role: "system", content: enrichedPrompt },
                        ...messages.map((m) => ({ role: m.role, content: m.content })),
                    ];
                    const baseStream = await streamDeepSeek(simpleMessages as Array<Record<string, unknown>>);
                    const taggedStream = appendCounterTags(baseStream, classifyPromise);
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
            // Two-pass: first check for tool calls (save_memory, create_zettel), then stream
            const { finalMessages } = await callDeepSeekWithTools(
                userId,
                messages,
                enrichedPrompt,
            );
            const baseStream = await streamDeepSeek(finalMessages as Array<Record<string, unknown>>);
            const taggedStream = appendCounterTags(baseStream, classifyPromise);
            return new Response(taggedStream, {
                headers: {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    Connection: "keep-alive",
                },
            });
        }

        // OpenAI: first pass with function calling (non-streaming)
        try {
            const { finalMessages } = await callOpenAIWithTools(
                userId,
                messages,
                enrichedPrompt,
            );

            // Second pass: stream the final response
            const baseStream = await streamOpenAI(finalMessages);
            const taggedStream = appendCounterTags(baseStream, classifyPromise);

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
                    const simpleMessages = [
                        { role: "system", content: enrichedPrompt },
                        ...messages.map((m) => ({ role: m.role, content: m.content })),
                    ];
                    const baseStream = await streamDeepSeek(simpleMessages as Array<Record<string, unknown>>);
                    const taggedStream = appendCounterTags(baseStream, classifyPromise);
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
                const taggedStream = appendCounterTags(baseStream, classifyPromise);
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
