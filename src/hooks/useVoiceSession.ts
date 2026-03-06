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
import { buildVaultContext } from "@/lib/obsidianVaultReader";
import { useUser } from "@/components/providers/UserProvider";
import { useEdgeTTS } from "@/hooks/useElevenLabsTTS";
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

    // Edge TTS (only used when ttsProvider === "edge")
    const { speak: speakEdgeTTS, stop: stopEdgeTTS } = useEdgeTTS();

    // Track the current AI response cycle
    const isAssistantResponding = useRef(false);
    const userTranscriptReceived = useRef(false);
    const lastAssistantText = useRef("");
    const edgeTtsMessageShown = useRef(false);
    const browserTtsWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const browserTtsKeepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const stopVoiceInternal = useCallback(() => {
        if (clientRef.current) {
            clientRef.current.stop();
            clientRef.current = null;
        }
        stopEdgeTTS();
        if (browserTtsWatchdogRef.current) {
            clearTimeout(browserTtsWatchdogRef.current);
            browserTtsWatchdogRef.current = null;
        }
        if (browserTtsKeepAliveRef.current) {
            clearInterval(browserTtsKeepAliveRef.current);
            browserTtsKeepAliveRef.current = null;
        }
        if ("speechSynthesis" in window) {
            window.speechSynthesis.cancel();
        }
        isAssistantResponding.current = false;
        userTranscriptReceived.current = false;
        edgeTtsMessageShown.current = false;
        setIsVoiceActive(false);
        setOrbState("idle");
        setModality("text");
    }, [setOrbState, setModality, stopEdgeTTS]);

    const startVoice = useCallback(async () => {
        if (clientRef.current) return;

        const ttsProvider = useSettingsStore.getState().ttsProvider;
        const useEdge = ttsProvider === "edge";

        setModality("voice");
        setOrbState("listening"); // Show listening while connecting

        // Create Edge TTS audio element during user gesture (mobile autoplay compat)
        const edgeTtsAudioEl = document.createElement("audio");
        edgeTtsAudioEl.setAttribute("playsinline", "true");
        edgeTtsAudioEl.style.display = "none";
        document.body.appendChild(edgeTtsAudioEl);

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

                const currentTts = useSettingsStore.getState().ttsProvider;

                if (currentTts === "browser") {
                    // Browser TTS: text and sound play together — show immediately
                    if (!isAssistantResponding.current) {
                        isAssistantResponding.current = true;
                        edgeTtsMessageShown.current = true;
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
                } else {
                    // Edge TTS: accumulate text, don't add to chat yet
                    // Message will be shown in onAudioEnd when playback starts
                    isAssistantResponding.current = true;
                    if (edgeTtsMessageShown.current) {
                        updateLastAssistantMessage({ content: accumulated });
                    }
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
                // Detect counter type from AI response
                const counterType = detectCounterType(
                    lastAssistantText.current,
                );

                // Save text before clearing (TTS callback needs it)
                const savedText = lastAssistantText.current;
                const aiText = counterType
                    ? stripCounterTag(savedText)
                    : savedText;

                // ── TTS: speak the response ──
                // Read current provider at call-time (not from closure)
                if (savedText) {
                    const textToSpeak = counterType
                        ? stripCounterTag(savedText)
                        : savedText;

                    const currentTtsProvider = useSettingsStore.getState().ttsProvider;

                    if (currentTtsProvider === "edge") {
                        // Show message in chat at the moment audio starts
                        if (!edgeTtsMessageShown.current && textToSpeak) {
                            edgeTtsMessageShown.current = true;
                            addMessage({
                                id: crypto.randomUUID(),
                                role: "assistant",
                                content: textToSpeak,
                                timestamp: new Date().toISOString(),
                                source: "voice",
                            });
                        }
                        // Trigger counter animation AFTER message is in chat
                        if (counterType) {
                            useAnimationStore.getState().triggerAnimation(counterType);
                        }
                        setOrbState("speaking");
                        void speakEdgeTTS(textToSpeak, () => {
                            clientRef.current?.unmuteMic();
                            setOrbState("listening");
                        }, edgeTtsAudioEl);
                    } else {
                        // Trigger counter animation for browser TTS (message already in chat)
                        if (counterType) {
                            useAnimationStore.getState().triggerAnimation(counterType);
                            updateLastAssistantMessage({ content: textToSpeak });
                        }

                        // Browser TTS via Web Speech API
                        if (textToSpeak && "speechSynthesis" in window) {
                            setOrbState("speaking");
                            window.speechSynthesis.cancel();

                            const utterance = new SpeechSynthesisUtterance(textToSpeak);
                            utterance.lang = "ru-RU";
                            utterance.rate = 1.0;
                            utterance.pitch = 1.0;

                            // Watchdog: force-unmute if onend doesn't fire
                            const watchdogMs = Math.max(5000, textToSpeak.length * 100);
                            browserTtsWatchdogRef.current = setTimeout(() => {
                                window.speechSynthesis.cancel();
                                clientRef.current?.unmuteMic();
                                setOrbState("listening");
                                browserTtsWatchdogRef.current = null;
                            }, watchdogMs);

                            const cleanup = () => {
                                if (browserTtsWatchdogRef.current) {
                                    clearTimeout(browserTtsWatchdogRef.current);
                                    browserTtsWatchdogRef.current = null;
                                }
                                if (browserTtsKeepAliveRef.current) {
                                    clearInterval(browserTtsKeepAliveRef.current);
                                    browserTtsKeepAliveRef.current = null;
                                }
                                clientRef.current?.unmuteMic();
                                setOrbState("listening");
                            };

                            utterance.onend = cleanup;
                            utterance.onerror = cleanup;

                            window.speechSynthesis.speak(utterance);

                            // Chrome bug workaround: speechSynthesis pauses after ~15s
                            browserTtsKeepAliveRef.current = setInterval(() => {
                                if (!window.speechSynthesis.speaking) {
                                    if (browserTtsKeepAliveRef.current) {
                                        clearInterval(browserTtsKeepAliveRef.current);
                                        browserTtsKeepAliveRef.current = null;
                                    }
                                    return;
                                }
                                window.speechSynthesis.pause();
                                window.speechSynthesis.resume();
                            }, 10000);
                        } else {
                            clientRef.current?.unmuteMic();
                            setOrbState("listening");
                        }
                    }
                } else {
                    // No text to speak — unmute immediately
                    clientRef.current?.unmuteMic();
                    setOrbState("listening");
                }

                // ── Auto-send to Obsidian (fire-and-forget) ──
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

                isAssistantResponding.current = false;
                userTranscriptReceived.current = false;
                lastAssistantText.current = "";
                edgeTtsMessageShown.current = false;
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

            // Append user's Obsidian vault notes (client-side read)
            try {
                const vaultCtx = await buildVaultContext();
                if (vaultCtx) {
                    voiceContext += "\n" + vaultCtx;
                }
            } catch {
                // Vault read failed silently
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
