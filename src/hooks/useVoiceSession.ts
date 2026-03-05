"use client";

import { useRef, useCallback, useState } from "react";
import {
    RealtimeVoiceClient,
    type VoiceClientCallbacks,
} from "@/lib/realtimeVoiceClient";
import { useChatStore } from "@/stores/chatStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useAnimationStore } from "@/stores/animationStore";
import { useCountersStore } from "@/stores/countersStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { detectCounterType, stripCounterTag } from "@/lib/detectCounterType";
import { sendToObsidian } from "@/lib/obsidianClient";
import { useUser } from "@/components/providers/UserProvider";
import { useEdgeTTS } from "@/hooks/useElevenLabsTTS";
import { logger } from "@/lib/logger";

/** Separate audio element for Edge TTS (created during user gesture) */
let edgeTtsAudioEl: HTMLAudioElement | null = null;

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

    const { speak: speakEdgeTTS, stop: stopEdgeTTS } = useEdgeTTS();

    const isAssistantResponding = useRef(false);
    const userTranscriptReceived = useRef(false);
    const lastAssistantText = useRef("");

    // Flag: true while Edge TTS is playing.
    // ALL callbacks are blocked while this is true — mic stays on but
    // any echo that OpenAI processes gets silently discarded in the callback.
    const edgeTtsSpeaking = useRef(false);

    const stopVoiceInternal = useCallback(() => {
        if (clientRef.current) {
            clientRef.current.stop();
            clientRef.current = null;
        }
        stopEdgeTTS();
        edgeTtsSpeaking.current = false;
        isAssistantResponding.current = false;
        userTranscriptReceived.current = false;
        setIsVoiceActive(false);
        setOrbState("idle");
        setModality("text");
    }, [setOrbState, setModality, stopEdgeTTS]);

    const startVoice = useCallback(async () => {
        if (clientRef.current) return;

        const ttsProvider = useSettingsStore.getState().ttsProvider;
        const useEdge = ttsProvider === "edge";

        setModality("voice");
        setOrbState("listening");

        // Create Edge TTS audio element during user gesture (mobile autoplay compat)
        if (useEdge && !edgeTtsAudioEl) {
            edgeTtsAudioEl = document.createElement("audio");
            edgeTtsAudioEl.setAttribute("playsinline", "true");
            edgeTtsAudioEl.style.display = "none";
            document.body.appendChild(edgeTtsAudioEl);
        }

        const callbacks: VoiceClientCallbacks = {
            onConnected: () => {
                setOrbState("listening");
            },

            onTranscriptUser: (text: string) => {
                // Block echo transcripts during Edge TTS
                if (edgeTtsSpeaking.current) return;

                const userMsg = {
                    id: crypto.randomUUID(),
                    role: "user" as const,
                    content: text,
                    timestamp: new Date().toISOString(),
                    source: "voice" as const,
                };

                const messages = useChatStore.getState().messages;
                const lastMsg = messages[messages.length - 1];
                if (lastMsg && lastMsg.role === "assistant") {
                    insertMessageBeforeLastAssistant(userMsg);
                } else {
                    addMessage(userMsg);
                }
            },

            onTranscriptAssistant: (accumulated: string) => {
                // Block echo responses during Edge TTS
                if (edgeTtsSpeaking.current) return;

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
                if (edgeTtsSpeaking.current) return;
                setOrbState("speaking");
            },

            onUserSpeechStarted: () => {
                if (edgeTtsSpeaking.current) return;
                setOrbState("listening");
            },

            onUserSpeechStopped: () => {
                if (edgeTtsSpeaking.current) return;
                setOrbState("thinking");
            },

            onAudioEnd: () => {
                // Block echo response completion during Edge TTS
                if (edgeTtsSpeaking.current) return;

                // Detect counter type
                const counterType = detectCounterType(
                    lastAssistantText.current,
                );
                if (counterType) {
                    useAnimationStore
                        .getState()
                        .triggerAnimation(counterType);
                    const cleaned = stripCounterTag(
                        lastAssistantText.current,
                    );
                    updateLastAssistantMessage({ content: cleaned });
                }

                // ── Edge TTS: speak the response ──
                if (useEdge && lastAssistantText.current) {
                    const textToSpeak = counterType
                        ? stripCounterTag(lastAssistantText.current)
                        : lastAssistantText.current;

                    // Block ALL callbacks during Edge TTS playback
                    edgeTtsSpeaking.current = true;
                    setOrbState("speaking");

                    const savedText = lastAssistantText.current;
                    isAssistantResponding.current = false;
                    userTranscriptReceived.current = false;
                    lastAssistantText.current = "";

                    void speakEdgeTTS(textToSpeak, () => {
                        // Edge TTS finished — clear audio buffer, unblock callbacks
                        clientRef.current?.clearAudioBuffer();

                        // Small delay to let buffer clear propagate before unblocking
                        setTimeout(() => {
                            edgeTtsSpeaking.current = false;
                            setOrbState("listening");
                        }, 300);

                        // Post-response processing
                        const aiText = counterType
                            ? stripCounterTag(savedText)
                            : savedText;
                        if (aiText) {
                            const msgs = useChatStore.getState().messages;
                            const lastUser = [...msgs]
                                .reverse()
                                .find((m) => m.role === "user");
                            if (lastUser) {
                                sendToObsidian(lastUser.content, aiText).catch(
                                    () => { /* handled inside */ },
                                );
                            }
                        }
                        const userMsgForMem = [...useChatStore.getState().messages]
                            .reverse()
                            .find((m) => m.role === "user");
                        fetch("/api/voice-memory", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                userId,
                                userText: userMsgForMem?.content,
                                assistantText: aiText || savedText,
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
                    }, edgeTtsAudioEl);

                    return;
                }

                // ── Standard (browser) mode ──
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
                            () => { /* handled inside */ },
                        );
                    }
                }

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
                // Context fetch failed silently
            }

            await client.start(voiceContext, useEdge);
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
        speakEdgeTTS,
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
