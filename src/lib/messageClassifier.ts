import { logger } from "@/lib/logger";
import { writeNoteToVault } from "@/lib/vaultWriter";
import { saveMemory } from "@/lib/memoryStore";

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;

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
- "fact" — факт, данные, цифры, новость, обновление, информация, предпочтение, любимое
- "task" — задача, действие, план (слова: нужно, стоит, надо, пересмотреть, сделать, внести, обновить, изучить)
- "persona" — конкретный человек с контекстом

ПРАВИЛА:
1. Проверь сообщение на КАЖДУЮ из 4 категорий отдельно
2. Одно сообщение ВСЕГДА может содержать 2-4 элемента — ищи ВСЕ
3. Если есть хоть намёк на категорию — ВКЛЮЧАЙ элемент
4. Лучше включить лишний элемент, чем пропустить нужный
5. "Мой любимый фильм/книга/цвет" = ФАКТ (одна заметка, не две!)

ПРИМЕР 1:
Вход: "Обновление Figma добавило новые auto-layout-функции, стоит пересмотреть шаблоны, чтобы использовать их эффективнее."
Выход:
[
  {"type":"fact","title":"Обновление Figma auto-layout","essence":"Figma добавила новые auto-layout-функции"},
  {"type":"idea","title":"Эффективное использование auto-layout","essence":"Адаптировать шаблоны для эффективного использования новых auto-layout-функций Figma"},
  {"type":"task","title":"Пересмотреть шаблоны Figma","essence":"Пересмотреть и обновить рабочие шаблоны с учётом новых auto-layout-функций"}
]

ПРИМЕР 2:
Вход: "Мой любимый фильм это Красотка"
Выход:
[
  {"type":"fact","title":"Любимый фильм — Красотка","essence":"Любимый фильм пользователя — Красотка"}
]

Если в сообщении НЕТ идей/фактов/задач (только приветствие) — верни: []
Отвечай ТОЛЬКО валидным JSON-массивом.`;

/**
 * Call Gemini REST API for classification.
 */
async function classifyWithGemini(userMessage: string): Promise<string> {
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_GEMINI_API_KEY}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: CLASSIFICATION_PROMPT }] },
                contents: [{ role: "user", parts: [{ text: userMessage }] }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 1000 },
            }),
            signal: AbortSignal.timeout(15000),
        },
    );

    if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`Gemini ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "[]";
}

/**
 * Call OpenAI-compatible API for classification.
 */
async function classifyWithChat(userMessage: string, provider: "openai" | "deepseek"): Promise<string> {
    const apiKey = provider === "openai" ? OPENAI_API_KEY : DEEPSEEK_API_KEY;
    const apiUrl = provider === "openai"
        ? "https://api.openai.com/v1/chat/completions"
        : "https://api.deepseek.com/chat/completions";
    const model = provider === "openai" ? "gpt-4o-mini" : "deepseek-chat";

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
        throw new Error(`${model} ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0]?.message?.content?.trim() ?? "[]";
}

/**
 * Classifies a user message into ideas/facts/tasks/personas,
 * creates Zettelkasten notes, and returns counter tags to inject.
 */
export async function classifyAndSave(
    userId: string,
    userMessage: string,
): Promise<ClassificationResult> {
    if (userMessage.trim().length < 15) {
        return { items: [], counterTags: [] };
    }

    if (!OPENAI_API_KEY && !GOOGLE_GEMINI_API_KEY && !DEEPSEEK_API_KEY) {
        return { items: [], counterTags: [] };
    }

    try {
        // Priority: OpenAI (works through VPN, separate quota) → Gemini → DeepSeek
        let raw: string;
        if (OPENAI_API_KEY) {
            logger.info(`[Classifier] Using gpt-4o-mini for: "${userMessage.slice(0, 50)}..."`);
            raw = await classifyWithChat(userMessage, "openai");
        } else if (GOOGLE_GEMINI_API_KEY) {
            logger.info(`[Classifier] Using Gemini for: "${userMessage.slice(0, 50)}..."`);
            raw = await classifyWithGemini(userMessage);
        } else {
            logger.info(`[Classifier] Using deepseek-chat for: "${userMessage.slice(0, 50)}..."`);
            raw = await classifyWithChat(userMessage, "deepseek");
        }

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
