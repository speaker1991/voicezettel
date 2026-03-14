"use client";

import { useRef, useCallback } from "react";
import { useChatStore } from "@/stores/chatStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useCountersStore } from "@/stores/countersStore";
import { useUser } from "@/components/providers/UserProvider";
import { stripDSML } from "@/lib/stripDSML";

/**
 * Sub-hook: streams a user message to /api/chat and calls onSentence
 * for each detected sentence boundary (. ! ? …).
 *
 * Returns the full accumulated response text.
 */
export function useChatStream() {
    const { userId } = useUser();
    const updateLastAssistantMessage = useChatStore((s) => s.updateLastAssistantMessage);
    const abortRef = useRef<AbortController | null>(null);

    const abort = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
    }, []);

    const sendToChat = useCallback(async (
        userText: string,
        onSentence: (sentence: string) => void,
    ): Promise<string> => {
        const { aiProvider, systemPrompt } = useSettingsStore.getState();
        const allMessages = useChatStore.getState().messages;
        const history = allMessages.slice(-20).map((m) => ({
            role: m.role,
            content: m.content,
        }));

        abortRef.current = new AbortController();

        const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                messages: history,
                provider: aiProvider,
                systemPrompt,
                userId,
                source: "voice",
            }),
            signal: abortRef.current.signal,
        });

        if (!res.ok) {
            const errBody = await res.json().catch(() => ({
                error: "Unknown error",
            }));
            throw new Error(
                (errBody as { error?: string }).error ?? `HTTP ${res.status}`,
            );
        }
        if (!res.body) throw new Error("No response body");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";
        let sentenceBuffer = "";
        let streamModel = "";
        let streamPromptTokens = 0;
        let streamCompletionTokens = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");

            for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const data = line.slice(6).trim();
                if (data === "[DONE]") continue;

                try {
                    const parsed = JSON.parse(data) as {
                        choices?: Array<{ delta?: { content?: string } }>;
                        model?: string;
                        usage?: {
                            prompt_tokens?: number;
                            completion_tokens?: number;
                        };
                    };

                    if (parsed.model && !streamModel) {
                        streamModel = parsed.model;
                    }
                    if (parsed.usage) {
                        streamPromptTokens = parsed.usage.prompt_tokens ?? 0;
                        streamCompletionTokens = parsed.usage.completion_tokens ?? 0;
                    }

                    const content = parsed.choices?.[0]?.delta?.content;
                    if (content) {
                        accumulated += content;
                        // Strip DSML in real-time so chat bubble never shows tags
                        updateLastAssistantMessage({ content: stripDSML(accumulated) });

                        // Check if we've entered a DSML block — stop feeding sentences to TTS
                        const dsmlStartPattern = /<\s*\|?\s*(?:DSML|function_calls?|antml|invoke)/i;
                        const inDsml = dsmlStartPattern.test(accumulated);

                        if (!inDsml) {
                            sentenceBuffer += content;

                            // Detect sentence boundaries: .!?… followed by space or newline
                            const sentenceEnd = /[.!?…]+[\s\n]+/;
                            let match = sentenceEnd.exec(sentenceBuffer);
                            while (match) {
                                const idx = match.index + match[0].length;
                                const sentence = sentenceBuffer.slice(0, idx).trim();
                                if (sentence.length > 5) {
                                    onSentence(sentence);
                                }
                                sentenceBuffer = sentenceBuffer.slice(idx);
                                match = sentenceEnd.exec(sentenceBuffer);
                            }
                        }
                    }
                } catch {
                    // skip
                }
            }
        }

        // Flush remaining text as final sentence (strip any DSML that leaked in)
        const cleanRemaining = stripDSML(sentenceBuffer).trim();
        if (cleanRemaining.length > 2) {
            onSentence(cleanRemaining);
        }

        // Report token usage
        if (streamPromptTokens > 0 || streamCompletionTokens > 0) {
            const reportModel = streamModel || "gpt-4o-mini";
            useCountersStore.getState().reportTokenUsage(
                userId ?? "",
                reportModel,
                streamPromptTokens,
                streamCompletionTokens,
            ).catch(() => { /* silent */ });
        }

        abortRef.current = null;
        return accumulated;
    }, [userId, updateLastAssistantMessage]);

    return { sendToChat, abort, abortRef } as const;
}
