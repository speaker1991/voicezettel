import { logger } from "@/lib/logger";
import {
    saveMemory,
    searchMemories,
} from "@/lib/memoryStore";
import { writeNoteToVault } from "@/lib/vaultWriter";
import type { ToolCall } from "@/lib/providers/base";

// ── Function calling tool definitions ────────────────────────

export const MEMORY_TOOLS = [
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

// ── Execute tool calls ───────────────────────────────────────

export async function handleToolCalls(
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
            const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;

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
                logger.debug(`Memory search: "${query}" → ${found.length} results`);
            } else if (tc.function.name === "create_zettel") {
                const title = args.title as string;
                const essence = args.essence as string;
                const action = args.action as string;
                const tags = (args.tags as string[]) ?? [];
                const compass = args.compass as { north: string; south: string; east: string; west: string };
                const context = args.context as string;
                const noteType = args.noteType as string;

                const now = new Date();
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
                const writeResult = await writeNoteToVault(userId, safeTitle, markdown);
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
                    error: err instanceof Error ? err.message : "Unknown error",
                }),
            });
        }
    }

    return results;
}
