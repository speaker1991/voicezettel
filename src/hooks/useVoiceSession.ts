"use client";

import { useRef, useCallback, useState } from "react";
import {
    RealtimeVoiceClient,
    type VoiceClientCallbacks,
} from "@/lib/realtimeVoiceClient";
import { useChatStore } from "@/stores/chatStore";
import { useAnimationStore } from "@/stores/animationStore";
import { useCountersStore } from "@/stores/countersStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { detectCounterType, stripCounterTag } from "@/lib/detectCounterType";
import { sendToObsidian } from "@/lib/obsidianClient";
import { useUser } from "@/components/providers/UserProvider";
import { logger } from "@/lib/logger";

export function useVoiceSession() {
    const clientRef = useRef<RealtimeVoiceClient | null>(null);
    const [isVoiceActive, setIsVoiceActive] = useState(false);
    const { userId } = useUser();

    const addMessage = useChatStore((s) => s.addMessage);
    const updateLastAssistantMessage = useChatStore(
        (s) => s.updateLastAssistantMessage
    );
    const insertMessageBeforeLastAssistant = useChatStore(
        (s) => s.insertMessageBeforeLastAssistant
    );
    const setOrbState = useChatStore((s) => s.setOrbState);
    const setModality = useChatStore((s) => s.setModality);

    // Track the current AI response cycle
    const isAssistantResponding = useRef(false);
    // Track if user transcript for current turn already arrived
    const userTranscriptReceived = useRef(false);
    // Track accumulated AI response text for counter detection
    const lastAssistantText = useRef("");

    const stopVoiceInternal = useCallback(() => {
        if (clientRef.current) {
            clientRef.current.stop();
            clientRef.current = null;
        }
        isAssistantResponding.current = false;
        userTranscriptReceived.current = false;
        setIsVoiceActive(false);
        setOrbState("idle");
        setModality("text");
    }, [setOrbState, setModality]);

    const startVoice = useCallback(async () => {
        if (clientRef.current) return;

        setModality("voice");
        setOrbState("listening"); // Show listening while connecting

        const callbacks: VoiceClientCallbacks = {
            onConnected: () => {
                setOrbState("listening");
            },

            onTranscriptUser: (text: string) => {
                const userMsg = {
                    id: crypto.randomUUID(),
                    role: "user" as const,
                    content: text,
                    timestamp: new Date().toISOString(),
                    source: "voice" as const,
                };

                // Check if last message is from assistant (AI responded before transcript arrived)
                const messages = useChatStore.getState().messages;
                const lastMsg = messages[messages.length - 1];
                if (lastMsg && lastMsg.role === "assistant") {
                    insertMessageBeforeLastAssistant(userMsg);
                } else {
                    addMessage(userMsg);
                }
            },

            onTranscriptAssistant: (accumulated: string) => {
                lastAssistantText.current = accumulated;
                if (!isAssistantResponding.current) {
                    isAssistantResponding.current = true;
                    addMessage({
                        id: crypto.randomUUID(),
                        role: "assistant",
                        content: accumulated,
                        timestamp: new Date().toISOString(),
                        source: "voice",
                    });
                    setOrbState("speaking");
                } else {
                    updateLastAssistantMessage({ content: accumulated });
                }
            },

            onAudioStart: () => {
                // Double-mute in case speech_stopped didn't fire
                clientRef.current?.muteMic();
                setOrbState("speaking");
            },

            onUserSpeechStarted: () => {
                setOrbState("listening");
            },

            onUserSpeechStopped: () => {
                // Mute mic immediately — AI will respond soon
                clientRef.current?.muteMic();
                setOrbState("thinking");
            },

            onAudioEnd: () => {
                // Unmute mic for next user turn
                clientRef.current?.unmuteMic();

                // Detect counter type from AI response
                const counterType = detectCounterType(
                    lastAssistantText.current,
                );
                if (counterType) {
                    useAnimationStore
                        .getState()
                        .triggerAnimation(counterType);
                    // Strip tag from displayed message
                    const cleaned = stripCounterTag(
                        lastAssistantText.current,
                    );
                    updateLastAssistantMessage({ content: cleaned });
                }

                // ── Auto-send to Obsidian (fire-and-forget) ──
                const aiText = counterType
                    ? stripCounterTag(lastAssistantText.current)
                    : lastAssistantText.current;
                if (aiText) {
                    const msgs = useChatStore.getState().messages;
                    const lastUser = [...msgs]
                        .reverse()
                        .find((m) => m.role === "user");
                    if (lastUser) {
                        sendToObsidian(lastUser.content, aiText).catch(
                            () => {
                                /* handled inside sendToObsidian */
                            },
                        );
                    }
                }

                // ── Save to memory store + classify ──
                const userMsgForMem = [...useChatStore.getState().messages]
                    .reverse()
                    .find((m) => m.role === "user");
                fetch("/api/voice-memory", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        userId,
                        userText: userMsgForMem?.content,
                        assistantText: aiText || lastAssistantText.current,
                    }),
                })
                    .then((res) => res.json())
                    .then((data: { counterTags?: string[] }) => {
                        if (data.counterTags && data.counterTags.length > 0) {
                            for (const tag of data.counterTags) {
                                const match = /\[COUNTER:(ideas|facts|persons|tasks)\]/i.exec(tag);
                                if (match) {
                                    useAnimationStore
                                        .getState()
                                        .triggerAnimation(match[1].toLowerCase() as "ideas" | "facts" | "persons" | "tasks");
                                }
                            }
                        }
                    })
                    .catch(() => { /* silent */ });

                isAssistantResponding.current = false;
                userTranscriptReceived.current = false;
                lastAssistantText.current = "";
                setOrbState("listening");
            },

            onSessionError: (err: Error) => {
                logger.error("Voice session error:", err.message);
                useNotificationStore
                    .getState()
                    .addNotification(err.message, "error");
                stopVoiceInternal();
            },

            onTokenUsage: (usage) => {
                useCountersStore.getState().reportTokenUsage(
                    userId ?? "",
                    "gpt-4o-mini-realtime-preview",
                    usage.textIn,
                    usage.textOut,
                    usage.audioIn,
                    usage.audioOut,
                ).catch(() => { /* silent */ });
            },
        };

        const client = new RealtimeVoiceClient(callbacks);
        clientRef.current = client;

        try {
            // Fetch context (memory + vault + chat) for voice instructions
            let voiceContext = "";
            try {
                const msgs = useChatStore.getState().messages;
                const recentMessages = msgs.slice(-10).map((m) => ({
                    role: m.role,
                    content: m.content,
                }));

                const ctxRes = await fetch("/api/voice-context", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userId, recentMessages }),
                });

                if (ctxRes.ok) {
                    const ctxData = (await ctxRes.json()) as { context?: string };
                    voiceContext = ctxData.context ?? "";
                }
            } catch {
                // Context fetch failed silently — voice still works
            }

            await client.start(voiceContext);
            setIsVoiceActive(true);
        } catch (err) {
            logger.error(
                "Failed to start voice session:",
                err instanceof Error ? err.message : err
            );
            useNotificationStore
                .getState()
                .addNotification(
                    `Не удалось запустить голос: ${err instanceof Error ? err.message : "Неизвестная ошибка"}`,
                    "error",
                );
            clientRef.current = null;
            setOrbState("idle");
            setModality("text");
        }
    }, [
        userId,
        addMessage,
        updateLastAssistantMessage,
        insertMessageBeforeLastAssistant,
        setOrbState,
        setModality,
        stopVoiceInternal,
    ]);

    const stopVoice = useCallback(() => {
        stopVoiceInternal();
    }, [stopVoiceInternal]);

    return {
        isVoiceActive,
        startVoice,
        stopVoice,
    } as const;
}
