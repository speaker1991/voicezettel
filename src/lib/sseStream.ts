/**
 * @module sseStream
 * SSE response creation and post-processing.
 *
 * Two modes:
 * - **Voice**: zero-buffering passthrough for low-latency TTS playback.
 * - **Text**: full buffering → DSML detection → function execution → counter tags.
 */
import { logger } from "@/lib/logger";
import { parseDSMLCalls, hasDSML, extractTextBeforeDSML } from "@/lib/parseDSML";
import {
    saveMemory,
    searchMemories,
} from "@/lib/memoryStore";
import { writeNoteToVault } from "@/lib/vaultWriter";
import { SSE_HEADERS } from "@/lib/providers/base";

/**
 * Create a standard SSE Response from a ReadableStream.
 */
export function createSSEResponse(stream: ReadableStream<Uint8Array>): Response {
    return new Response(stream, { headers: SSE_HEADERS });
}

/**
 * Post-process an SSE stream:
 * - Voice mode (isVoice=true): zero-buffering passthrough for low-latency TTS
 * - Text mode (isVoice=false): full buffering for DSML detection, function execution, and counter tags
 */
export function appendCounterTags(
    baseStream: ReadableStream<Uint8Array>,
    classifyPromise: Promise<{ counterTags: string[] }>,
    userId?: string,
    isVoice?: boolean,
): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // ── VOICE MODE: low-latency passthrough + counter tags at end ──
    if (isVoice) {
        return new ReadableStream<Uint8Array>({
            async start(controller) {
                const reader = baseStream.getReader();
                let buf = "";
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        buf += decoder.decode(value, { stream: true });
                        const parts = buf.split("\n\n");
                        buf = parts.pop() ?? "";
                        for (const part of parts) {
                            const trimmed = part.trim();
                            if (!trimmed || trimmed === "data: [DONE]") continue;
                            controller.enqueue(encoder.encode(trimmed + "\n\n"));
                        }
                    }
                    if (buf.trim() && buf.trim() !== "data: [DONE]") {
                        controller.enqueue(encoder.encode(buf));
                    }
                } catch { /* stream interrupted */ }

                // Append counter tags at the end (invisible to user —
                // client-side detectCounterTypes strips them and triggers animation)
                try {
                    const result = await classifyPromise;
                    if (result.counterTags.length > 0) {
                        const tagStr = " " + result.counterTags.join(" ");
                        const chunk = JSON.stringify({
                            choices: [{ delta: { content: tagStr }, index: 0 }],
                        });
                        controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
                    }
                } catch { /* classifier failed — not critical */ }

                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
            },
        });
    }

    // ── TEXT MODE: full buffering for DSML detection + counter tags ──
    return new ReadableStream<Uint8Array>({
        async start(controller) {
            const reader = baseStream.getReader();
            let rawBuffer = "";
            const collectedParts: string[] = [];
            let fullContent = "";

            // 1. Collect ALL chunks
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
            } catch { /* stream interrupted */ }

            // 2. Check for DSML
            const containsDSML = hasDSML(fullContent);

            if (containsDSML) {
                const cleanText = extractTextBeforeDSML(fullContent);
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
                // No DSML: replay all buffered chunks
                for (const part of collectedParts) {
                    controller.enqueue(encoder.encode(part + "\n\n"));
                }
            }

            // Append counter tags
            try {
                const result = await classifyPromise;
                if (result.counterTags.length > 0) {
                    const tagStr = " " + result.counterTags.join(" ");
                    const chunk = JSON.stringify({
                        choices: [{ delta: { content: tagStr }, index: 0 }],
                    });
                    controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
                }
            } catch { /* classifier failed */ }

            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
        },
    });
}
