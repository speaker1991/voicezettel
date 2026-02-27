"use client";

import { useCallback, useRef } from "react";
import { useChatStore } from "@/stores/chatStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useAnimationStore } from "@/stores/animationStore";
import { useCountersStore } from "@/stores/countersStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { detectCounterType, stripCounterTag } from "@/lib/detectCounterType";
import { logger } from "@/lib/logger";

export function useTextChat() {
    const addMessage = useChatStore((s) => s.addMessage);
    const updateLastAssistantMessage = useChatStore(
        (s) => s.updateLastAssistantMessage,
    );
    const setOrbState = useChatStore((s) => s.setOrbState);
    const abortRef = useRef<AbortController | null>(null);

    const sendMessage = useCallback(
        async (userText: string) => {
            const trimmed = userText.trim();
            if (!trimmed) return;

            // 1. Add user message
            const userMsg = {
                id: crypto.randomUUID(),
                role: "user" as const,
                content: trimmed,
                timestamp: new Date().toISOString(),
                source: "text" as const,
            };
            addMessage(userMsg);

            // 2. Read settings
            const { aiProvider, systemPrompt } =
                useSettingsStore.getState();

            // 3. Build message history (last 20 messages for context)
            const allMessages = useChatStore.getState().messages;
            const history = allMessages.slice(-20).map((m) => ({
                role: m.role,
                content: m.content,
            }));

            // 4. Set orb to thinking
            setOrbState("thinking");

            // 5. Create assistant placeholder
            const assistantId = crypto.randomUUID();
            addMessage({
                id: assistantId,
                role: "assistant",
                content: "",
                timestamp: new Date().toISOString(),
                source: "text",
            });

            // 6. Stream response
            abortRef.current = new AbortController();

            try {
                const res = await fetch("/api/chat", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        messages: history,
                        provider: aiProvider,
                        systemPrompt,
                    }),
                    signal: abortRef.current.signal,
                });

                if (!res.ok) {
                    const errBody = await res.json().catch(() => ({
                        error: "Unknown error",
                    }));
                    throw new Error(
                        (errBody as { error?: string }).error ??
                        `HTTP ${res.status}`,
                    );
                }

                if (!res.body) throw new Error("No response body");

                setOrbState("speaking");

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let accumulated = "";

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
                                choices?: Array<{
                                    delta?: { content?: string };
                                }>;
                                usage?: {
                                    prompt_tokens?: number;
                                    completion_tokens?: number;
                                    total_tokens?: number;
                                };
                            };

                            // Track token usage (comes in the final chunk)
                            if (parsed.usage?.total_tokens) {
                                useCountersStore
                                    .getState()
                                    .addTokensUsed(
                                        parsed.usage.total_tokens,
                                    );
                            }

                            const content =
                                parsed.choices?.[0]?.delta?.content;
                            if (content) {
                                accumulated += content;
                                updateLastAssistantMessage({
                                    content: accumulated,
                                });
                            }
                        } catch {
                            // skip unparseable SSE lines
                        }
                    }
                }

                // Detect counter type and trigger animation
                const counterType = detectCounterType(accumulated);
                if (counterType) {
                    useAnimationStore
                        .getState()
                        .triggerAnimation(counterType);
                    // Strip tag from displayed message
                    const cleaned = stripCounterTag(accumulated);
                    updateLastAssistantMessage({ content: cleaned });
                }
            } catch (err) {
                if ((err as Error).name === "AbortError") {
                    logger.debug("Text chat aborted");
                    return;
                }
                logger.error(
                    "Text chat error:",
                    (err as Error).message,
                );
                useNotificationStore
                    .getState()
                    .addNotification((err as Error).message, "error");
                updateLastAssistantMessage({
                    content: `⚠️ Ошибка: ${(err as Error).message}`,
                });
            } finally {
                abortRef.current = null;
                setOrbState("idle");
            }
        },
        [addMessage, updateLastAssistantMessage, setOrbState],
    );

    const abort = useCallback(() => {
        abortRef.current?.abort();
    }, []);

    return { sendMessage, abort } as const;
}
