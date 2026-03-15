import { logger } from "@/lib/logger";
import { writeNoteToVault } from "@/lib/vaultWriter";
import { saveMemory } from "@/lib/memoryStore";

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

interface ClassifiedItem {
    type: "idea" | "fact" | "task" | "persona";
    title: string;
    essence: string;
}

interface ClassificationResult {
    items: ClassifiedItem[];
    counterTags: string[];
}

const CLASSIFICATION_PROMPT = `Ты — классификатор текста. Проанализируй сообщение и извлеки ВСЕ элементы.

КАТЕГОРИИ:
- "idea" — идея, предложение, концепция, решение, адаптация
- "fact" — факт, данные, цифры, новость, обновление, информация
- "task" — задача, действие, план (слова: нужно, стоит, надо, пересмотреть, сделать, внести, обновить)
- "persona" — конкретный человек с контекстом

ПРАВИЛА:
1. Проверь сообщение на КАЖДУЮ из 4 категорий отдельно
2. Одно сообщение ВСЕГДА может содержать 2-4 элемента — ищи ВСЕ
3. Если есть хоть намёк на категорию — ВКЛЮЧАЙ элемент
4. Лучше включить лишний элемент, чем пропустить нужный

ПРИМЕР 1:
Вход: "Обновление Figma добавило новые auto-layout-функции, стоит пересмотреть шаблоны, чтобы использовать их эффективнее."
Выход:
[
  {"type":"fact","title":"Обновление Figma auto-layout","essence":"Figma добавила новые auto-layout-функции"},
  {"type":"idea","title":"Эффективное использование auto-layout","essence":"Адаптировать шаблоны для эффективного использования новых auto-layout-функций Figma"},
  {"type":"task","title":"Пересмотреть шаблоны Figma","essence":"Пересмотреть и обновить рабочие шаблоны с учётом новых auto-layout-функций"}
]

ПРИМЕР 2:
Вход: "На складе 375 процессоров, нужно заказать ещё 100 до конца недели"
Выход:
[
  {"type":"fact","title":"Остаток процессоров на складе","essence":"На складе 375 процессоров"},
  {"type":"task","title":"Заказать процессоры","essence":"Заказать ещё 100 процессоров до конца недели"}
]

Если в сообщении НЕТ идей/фактов/задач (только приветствие) — верни: []
Отвечай ТОЛЬКО валидным JSON-массивом.`;

/**
 * Classifies a user message into ideas/facts/tasks/personas,
 * creates Zettelkasten notes, and returns counter tags to inject.
 *
 * Runs as fire-and-forget — does not block the main response stream.
 */
export async function classifyAndSave(
    userId: string,
    userMessage: string,
): Promise<ClassificationResult> {
    if (userMessage.trim().length < 15) {
        return { items: [], counterTags: [] };
    }

    // Prefer DeepSeek (works from Russia), fallback to OpenAI
    const apiKey = DEEPSEEK_API_KEY || OPENAI_API_KEY;
    const apiUrl = DEEPSEEK_API_KEY
        ? "https://api.deepseek.com/chat/completions"
        : "https://api.openai.com/v1/chat/completions";
    const model = DEEPSEEK_API_KEY ? "deepseek-chat" : "gpt-4o-mini";

    if (!apiKey) {
        return { items: [], counterTags: [] };
    }

    try {
        logger.info(`[Classifier] Starting classification for: "${userMessage.slice(0, 50)}..." via ${model}`);
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model,
                temperature: 0.1,
                messages: [
                    { role: "system", content: CLASSIFICATION_PROMPT },
                    { role: "user", content: userMessage },
                ],
            }),
            signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => "");
            logger.error(`[Classifier] API error: ${response.status} — ${errText.slice(0, 200)}`);
            return { items: [], counterTags: [] };
        }

        const data = (await response.json()) as {
            choices: Array<{ message: { content: string } }>;
        };
        const raw = data.choices[0]?.message?.content?.trim() ?? "[]";

        // Parse JSON — strip markdown fences if present
        const cleaned = raw.replace(/^```json?\s*/i, "").replace(/```\s*$/, "");
        logger.info(`[Classifier] Raw response: ${cleaned.slice(0, 300)}`);
        const items = JSON.parse(cleaned) as ClassifiedItem[];

        if (!Array.isArray(items) || items.length === 0) {
            return { items: [], counterTags: [] };
        }

        const counterTags: string[] = [];
        const counterMap: Record<string, string> = {
            idea: "ideas",
            fact: "facts",
            task: "tasks",
            persona: "persons",
        };

        // Create zettels and save to memory for each item
        for (const item of items) {
            const tag = counterMap[item.type];
            if (tag) {
                counterTags.push(`[COUNTER:${tag}]`);
            }

            // Build Zettelkasten note
            const now = new Date();
            const dateStr = now.toISOString().slice(0, 10);
            const noteContent = `---
type: ${item.type}
created: ${dateStr}
tags: [${item.type}, auto-classified]
---

## Суть
${item.essence}

## Контекст
Из сообщения пользователя: "${userMessage.slice(0, 200)}"
`;

            // Save to Obsidian vault
            const fileName = `${dateStr} ${item.title.slice(0, 60).replace(/[/\\:*?"<>|]/g, "")}`;
            writeNoteToVault(
                userId,
                fileName,
                noteContent,
                "Zettelkasten",
            ).catch((err) =>
                logger.error("Classifier vault write error:", err),
            );

            // Save to memory
            saveMemory(
                userId,
                `[${item.type}] ${item.essence}`,
                [item.type, "auto-classified"],
            ).catch(() => { /* silent */ });
        }

        logger.info(
            `[Classifier] Classified ${items.length} items: ${items.map((i) => i.type).join(", ")} → tags: ${counterTags.join(" ")}`,
        );

        return { items, counterTags };
    } catch (err) {
        logger.error(
            "[Classifier] Error:",
            err instanceof Error ? `${err.message} (${err.name})` : err,
        );
        return { items: [], counterTags: [] };
    }
}
