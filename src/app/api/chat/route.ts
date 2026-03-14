import { NextRequest, NextResponse } from "next/server";
import { ChatRequestSchema } from "./types";
import { logger } from "@/lib/logger";
import { classifyAndSave } from "@/lib/messageClassifier";
import { saveMemory } from "@/lib/memoryStore";

// Providers
import { openaiProvider } from "@/lib/providers/openai";
import { deepseekProvider } from "@/lib/providers/deepseek";
import { googleProvider } from "@/lib/providers/google";
import { stripToolInstructions } from "@/lib/providers/base";

// Context & tools
import {
    buildMemoryContext,
    buildEnrichedPrompt,
    fetchChromaContext,
    ensureVaultPreloaded,
    autoSaveUserMessage,
    loadVaultContext,
} from "@/lib/chatContext";

// SSE post-processing
import { appendCounterTags, createSSEResponse } from "@/lib/sseStream";

// ── Environment checks ──
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

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
        return NextResponse.json({ error: "OPENAI_API_KEY is not configured" }, { status: 501 });
    }
    if (provider === "google" && !GOOGLE_GEMINI_API_KEY) {
        return NextResponse.json({ error: "GOOGLE_GEMINI_API_KEY is not configured" }, { status: 501 });
    }

    try {
        // ── 1. Build context (parallel) ──
        const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
        const userQuery = lastUserMsg?.content ?? "";

        const [vaultContext, memoryContext] = await Promise.all([
            loadVaultContext(userId),
            buildMemoryContext(userId, userQuery),
        ]);

        await ensureVaultPreloaded(userId);

        // ChromaDB RAG (optional, timeout-protected)
        const chromaContext = userQuery.length > 3
            ? await fetchChromaContext(userQuery)
            : "";

        const enrichedPrompt = buildEnrichedPrompt({
            systemPrompt: systemPrompt ?? "",
            provider,
            isVoice,
            memoryContext,
            vaultContext,
            chromaContext,
        });

        // ── 2. Auto-save user message (fire-and-forget) ──
        autoSaveUserMessage(userId, messages);

        // ── 3. Classify for counter tags (async) ──
        const classifyMsg = messages.filter((m) => m.role === "user").pop();
        const classifyPromise = classifyMsg
            ? classifyAndSave(userId, classifyMsg.content)
            : Promise.resolve({ items: [], counterTags: [] });

        // ── 4. Route to provider ──

        if (provider === "google") {
            return await handleGoogle(messages, enrichedPrompt, classifyPromise, userId, isVoice);
        }

        if (provider === "deepseek") {
            return handleDeepSeek(messages, enrichedPrompt, classifyPromise, userId, isVoice);
        }

        // Default: OpenAI
        return await handleOpenAI(messages, enrichedPrompt, classifyPromise, userId, isVoice);

    } catch (err) {
        const message = err instanceof Error ? err.message : "Unexpected error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

// ── Provider handlers ────────────────────────────────────────

async function handleGoogle(
    messages: Array<{ role: string; content: string }>,
    enrichedPrompt: string,
    classifyPromise: Promise<{ counterTags: string[] }>,
    userId: string,
    isVoice: boolean,
): Promise<Response> {
    try {
        const baseStream = await googleProvider.streamChat(messages as Array<Record<string, unknown>>, enrichedPrompt);
        return createSSEResponse(appendCounterTags(baseStream, classifyPromise, userId, isVoice));
    } catch (geminiErr) {
        const errMsg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
        logger.warn(`Gemini failed: ${errMsg.slice(0, 100)}`);

        if (DEEPSEEK_API_KEY) {
            logger.warn("Falling back to DeepSeek...");
            return fallbackDeepSeek(messages, enrichedPrompt, classifyPromise, userId, isVoice);
        }
        throw geminiErr;
    }
}

function handleDeepSeek(
    messages: Array<{ role: string; content: string }>,
    enrichedPrompt: string,
    classifyPromise: Promise<{ counterTags: string[] }>,
    userId: string,
    isVoice: boolean,
): Response {
    const finalMsgs: Array<Record<string, unknown>> = [
        { role: "system", content: enrichedPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    // DeepSeek streams directly (no tools — it outputs DSML text instead)
    const streamPromise = deepseekProvider.streamChat(finalMsgs);
    const wrappedStream = new ReadableStream<Uint8Array>({
        async start(controller) {
            try {
                const baseStream = await streamPromise;
                const tagged = appendCounterTags(baseStream, classifyPromise, userId, isVoice);
                const reader = tagged.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    controller.enqueue(value);
                }
            } catch (err) {
                logger.error("DeepSeek stream error:", (err as Error).message);
            }
            controller.close();
        },
    });

    return createSSEResponse(wrappedStream);
}

async function handleOpenAI(
    messages: Array<{ role: string; content: string }>,
    enrichedPrompt: string,
    classifyPromise: Promise<{ counterTags: string[] }>,
    userId: string,
    isVoice: boolean,
): Promise<Response> {
    try {
        let finalMsgs: Array<Record<string, unknown>>;
        if (isVoice) {
            finalMsgs = [
                { role: "system", content: enrichedPrompt },
                ...messages.map((m) => ({ role: m.role, content: m.content })),
            ];
        } else {
            const { finalMessages } = await openaiProvider.callWithTools(userId, messages, enrichedPrompt);
            finalMsgs = finalMessages;
        }

        const baseStream = await openaiProvider.streamChat(finalMsgs);
        return createSSEResponse(appendCounterTags(baseStream, classifyPromise, userId, isVoice));

    } catch (openaiErr) {
        const errMsg = openaiErr instanceof Error ? openaiErr.message : "";
        const isBlocked = errMsg.includes("403") || errMsg.includes("unsupported_country");
        if (!isBlocked) throw openaiErr;

        // Fallback 1: DeepSeek
        if (DEEPSEEK_API_KEY) {
            try {
                logger.warn("OpenAI blocked (403), falling back to DeepSeek");
                return fallbackDeepSeek(messages, enrichedPrompt, classifyPromise, userId, isVoice);
            } catch (dsErr) {
                logger.warn("DeepSeek also failed:", (dsErr as Error).message);
            }
        }

        // Fallback 2: Gemini
        if (GOOGLE_GEMINI_API_KEY) {
            logger.warn("Falling back to Gemini");
            const baseStream = await googleProvider.streamChat(messages as Array<Record<string, unknown>>, enrichedPrompt);
            return createSSEResponse(appendCounterTags(baseStream, classifyPromise, userId, isVoice));
        }

        throw openaiErr;
    }
}

// ── Shared fallback ──────────────────────────────────────────

async function fallbackDeepSeek(
    messages: Array<{ role: string; content: string }>,
    enrichedPrompt: string,
    classifyPromise: Promise<{ counterTags: string[] }>,
    userId: string,
    isVoice: boolean,
): Promise<Response> {
    const dsPrompt = stripToolInstructions(enrichedPrompt);
    const simpleMessages: Array<Record<string, unknown>> = [
        { role: "system", content: dsPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const baseStream = await deepseekProvider.streamChat(simpleMessages);
    return createSSEResponse(appendCounterTags(baseStream, classifyPromise, userId, isVoice));
}
