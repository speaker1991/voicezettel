/**
 * @module chatContext
 * Context-building utilities for the chat API.
 * Assembles memory, vault notes, and ChromaDB RAG into the system prompt.
 */
import {
    getRecentMemories,
    searchMemories,
    saveMemory,
    preloadFromVault,
} from "@/lib/memoryStore";
import { loadVaultContext, loadVaultNotes } from "@/lib/vaultContext";
import { logger } from "@/lib/logger";

const LOCAL_CORE_URL = process.env.LOCAL_CORE_URL ?? "http://localhost:8000";

// ── ChromaDB RAG helper ──────────────────────────────────────

interface ChromaResult {
    id: string;
    text: string;
    metadata: Record<string, string>;
    distance: number;
    relevance_pct: number;
}

/**
 * Query ChromaDB (via Local Core) for semantically relevant vault notes.
 * Returns formatted context string or empty string on failure.
 * Timeout: 1500ms to avoid blocking the main response.
 */
export async function fetchChromaContext(query: string): Promise<string> {
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
        return "";
    }
}

// ── Build memory context ─────────────────────────────────────

/**
 * Build memory context from recent + semantically relevant memories.
 * @param userId - User identifier for memory isolation.
 * @param userMessage - Current user message for semantic search.
 * @returns Formatted memory context string to embed in system prompt.
 */
export async function buildMemoryContext(
    userId: string,
    userMessage: string,
): Promise<string> {
    const parts: string[] = [];

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

    const relevant = await searchMemories(userId, userMessage);
    if (relevant.length > 0) {
        const recentIds = new Set(recent.map((m) => m.id));
        const unique = relevant.filter((r) => !recentIds.has(r.memory.id));

        if (unique.length > 0) {
            parts.push("\n--- РЕЛЕВАНТНЫЕ ВОСПОМИНАНИЯ (по запросу) ---");
            for (const { memory, score } of unique) {
                const date = new Date(memory.createdAt).toLocaleDateString("ru-RU");
                parts.push(
                    `• ${memory.text} [${memory.tags.join(", ")}] (${date}, релевантность: ${(score * 100).toFixed(0)}%)`,
                );
            }
            parts.push("--- КОНЕЦ РЕЛЕВАНТНЫХ ---");
        }
    }

    return parts.join("\n");
}

// ── Build enriched system prompt ─────────────────────────────

const VOICE_RULES = `\n\n## ПРАВИЛА ДЛЯ ГОЛОСА:\n- Отвечай КРАТКО (1-3 предложения).\n- НЕ используй маркировку, списки, emoji — только чистый текст для озвучки.\n- НЕ вызывай функции, НЕ пиши XML/DSML теги.\n- Используй контекст из памяти и заметок если релевантен.`;

const DEEPSEEK_RULES = `\n\n## ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА:\nТы — приватный Экзокортекс пользователя. Запоминай всю личную информацию.\n- НИКОГДА не пиши XML, DSML, function_calls, invoke, parameter теги.\n- НЕ вызывай функции. Просто отвечай текстом.\n- Отвечай по-русски, дружелюбно и по существу.\n- Используй контекст из заметок и памяти ниже для релевантных ответов.\n\n### Счётчики\nЕсли в сообщении пользователя есть идея, факт, задача или упоминание человека — добавь в конец ответа тег:\n- Идеи → [COUNTER:ideas]\n- Факты → [COUNTER:facts]\n- Задачи → [COUNTER:tasks]\n- Люди → [COUNTER:persons]\nПример: "Записал факт! [COUNTER:facts]"`;

const DEFAULT_RULES = `\n\n## ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА (СТРОГО СЛЕДУЙ):

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

export interface EnrichPromptOptions {
    systemPrompt: string;
    provider: string;
    isVoice: boolean;
    memoryContext: string;
    vaultContext: string;
    chromaContext: string;
}

/**
 * Assemble the final system prompt with provider-specific rules,
 * memory context, vault context, and ChromaDB RAG context.
 */
export function buildEnrichedPrompt(opts: EnrichPromptOptions): string {
    let prompt = opts.systemPrompt;

    // Provider/mode-specific rules
    if (opts.isVoice) {
        prompt += VOICE_RULES;
    } else if (opts.provider === "deepseek") {
        prompt += DEEPSEEK_RULES;
    } else {
        prompt += DEFAULT_RULES;
    }

    // Append memory context
    if (opts.memoryContext) {
        prompt += `\n\n${opts.memoryContext}`;
    }

    // Append vault context
    if (opts.vaultContext) {
        prompt += `\n\n--- ЗАМЕТКИ ZETTELKASTEN (контекст из Obsidian) ---\nВот существующие заметки пользователя. Используй их как контекст для более релевантных ответов. Если пользователь спрашивает о чём-то связанном — ссылайся на эти заметки.\n${opts.vaultContext}\n--- КОНЕЦ ЗАМЕТОК ---`;
    }

    // Append ChromaDB context
    if (opts.chromaContext) {
        prompt += `\n\n${opts.chromaContext}`;
    }

    return prompt;
}

// ── Preload vault notes (first-time setup) ───────────────────

/**
 * Ensure the user's Obsidian vault notes are preloaded into the memory store.
 * Runs once per session — idempotent check via getRecentMemories.
 */
export async function ensureVaultPreloaded(userId: string): Promise<void> {
    const memCount = await getRecentMemories(userId, 1);
    if (memCount.length === 0) {
        const vaultNotes = await loadVaultNotes(userId);
        if (vaultNotes.length > 0) {
            await preloadFromVault(userId, vaultNotes.slice(0, 50));
        }
    }
}

// ── Auto-save user message to memory ─────────────────────────

/**
 * Fire-and-forget: persist the user's latest message to long-term memory.
 * Only saves messages longer than 10 characters.
 */
export function autoSaveUserMessage(
    userId: string,
    messages: Array<{ role: string; content: string }>,
): void {
    const lastUserMsg = messages
        .filter((m) => m.role === "user")
        .pop();
    if (lastUserMsg && lastUserMsg.content.trim().length > 10) {
        saveMemory(
            userId,
            `Пользователь написал: ${lastUserMsg.content.slice(0, 300)}`,
            ["chat", "user-said"],
        ).catch(() => { /* silent */ });
    }
}

// Re-export loadVaultContext for route.ts
export { loadVaultContext };
