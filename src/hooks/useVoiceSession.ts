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

/** Ref to a separate audio element for Edge TTS (created during user gesture) */
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

    // Edge TTS hook
    const { speak: speakEdgeTTS, stop: stopEdgeTTS } = useEdgeTTS();

    // Track the current AI response cycle
    const isAssistantResponding = useRef(false);
    const userTranscriptReceived = useRef(false);
    const lastAssistantText = useRef("");

    // Flag: true while Edge TTS is playing → ignore VAD events
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

        // Create a separate audio element for Edge TTS during user gesture
        // (mobile browsers require audio elements created in user interaction context)
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
                setOrbState("speaking");
            },

            onUserSpeechStarted: () => {
                // IGNORE VAD events while Edge TTS is playing
                // (Edge TTS audio gets picked up by mic → triggers false VAD)
                if (edgeTtsSpeaking.current) return;
                setOrbState("listening");
            },

            onUserSpeechStopped: () => {
                // IGNORE VAD events while Edge TTS is playing
                if (edgeTtsSpeaking.current) return;
                setOrbState("thinking");
            },

            onAudioEnd: () => {
                // Detect counter type from AI response
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

                    // Set flag: ignore VAD events during Edge TTS playback
                    edgeTtsSpeaking.current = true;
                    setOrbState("speaking");

                    // Disable mic to prevent echo pickup
                    clientRef.current?.disableMic();

                    // Save text before clearing refs
                    const savedText = lastAssistantText.current;
                    isAssistantResponding.current = false;
                    userTranscriptReceived.current = false;
                    lastAssistantText.current = "";

                    void speakEdgeTTS(textToSpeak, () => {
                        // Edge TTS finished:
                        // 1. Clear any echo audio from OpenAI's buffer
                        clientRef.current?.clearAudioBuffer();
                        // 2. Re-enable mic
                        clientRef.current?.enableMic();
                        // 3. Clear the flag
                        edgeTtsSpeaking.current = false;
                        setOrbState("listening");

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

                    return; // Skip normal post-response flow
                }

                // ── Standard (browser) mode: normal flow ──
                // No separate TTS — OpenAI audio already played
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
                // Context fetch failed silently — voice still works
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
