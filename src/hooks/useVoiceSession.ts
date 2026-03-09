"use client";

import { useRef, useCallback, useState, useEffect } from "react";
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
import { createRemoteLogger } from "@/lib/remoteLogger";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";

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
    const setAudioLevel = useChatStore((s) => s.setAudioLevel);
    const setLiveTranscript = useChatStore((s) => s.setLiveTranscript);

    // Edge TTS (only used when ttsProvider === "edge")
    const { speak: speakEdgeTTS, stop: stopEdgeTTS } = useEdgeTTS();

    // Web Speech API for real-time transcription display
    const { start: startRecognition, stop: stopRecognition } = useSpeechRecognition();

    // Track the current AI response cycle
    const isAssistantResponding = useRef(false);
    const isServerResponseActive = useRef(false); // true while OpenAI is streaming text, false after response.text.done
    const userTranscriptReceived = useRef(false);
    const lastAssistantText = useRef("");
    const edgeTtsMessageShown = useRef(false);
    const browserTtsWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const browserTtsKeepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const audioLevelRafRef = useRef<number | null>(null);
    const ttsAudioCtxRef = useRef<AudioContext | null>(null);
    const ttsAnalyserRef = useRef<AnalyserNode | null>(null);
    const ttsAnalyserDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

    // Single source of truth for resetting response cycle state
    const resetResponseState = useCallback(() => {
        isAssistantResponding.current = false;
        isServerResponseActive.current = false;
        userTranscriptReceived.current = false;
        lastAssistantText.current = "";
        edgeTtsMessageShown.current = false;
    }, []);

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
        resetResponseState();
        // Stop speech recognition
        stopRecognition();
        setLiveTranscript("");
        // Stop audio level metering
        if (audioLevelRafRef.current !== null) {
            cancelAnimationFrame(audioLevelRafRef.current);
            audioLevelRafRef.current = null;
        }
        setAudioLevel(0);
        // Clean up TTS analyser
        if (ttsAudioCtxRef.current) {
            ttsAudioCtxRef.current.close().catch(() => { /* silent */ });
            ttsAudioCtxRef.current = null;
            ttsAnalyserRef.current = null;
            ttsAnalyserDataRef.current = null;
        }
        setIsVoiceActive(false);
        setOrbState("idle");
        setModality("text");
    }, [setOrbState, setModality, stopEdgeTTS, resetResponseState, setAudioLevel, setLiveTranscript]);

    // Hot-swap TTS provider: interrupt active TTS when provider changes mid-session
    useEffect(() => {
        const unsub = useSettingsStore.subscribe(
            (s) => s.ttsProvider,
            () => {
                // Stop any active TTS playback
                stopEdgeTTS();
                if ("speechSynthesis" in window) {
                    window.speechSynthesis.cancel();
                }
                if (browserTtsWatchdogRef.current) {
                    clearTimeout(browserTtsWatchdogRef.current);
                    browserTtsWatchdogRef.current = null;
                }
                if (browserTtsKeepAliveRef.current) {
                    clearInterval(browserTtsKeepAliveRef.current);
                    browserTtsKeepAliveRef.current = null;
                }
                // If voice session is active — reset state
                if (clientRef.current) {
                    resetResponseState();
                    setOrbState("listening");
                }
            },
        );
        return () => unsub();
    }, [stopEdgeTTS, resetResponseState, setOrbState]);

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

        // Set up TTS audio analyser for orb visualization during assistant speech
        try {
            const ttsCtx = new AudioContext();
            const ttsSource = ttsCtx.createMediaElementSource(edgeTtsAudioEl);
            const ttsAnalyser = ttsCtx.createAnalyser();
            ttsAnalyser.fftSize = 256;
            ttsSource.connect(ttsAnalyser);
            ttsAnalyser.connect(ttsCtx.destination); // must connect to hear audio
            ttsAudioCtxRef.current = ttsCtx;
            ttsAnalyserRef.current = ttsAnalyser;
            ttsAnalyserDataRef.current = new Uint8Array(ttsAnalyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
        } catch {
            // Non-critical — TTS will still play, just no orb reactivity
        }

        const callbacks: VoiceClientCallbacks = {
            onConnected: () => {
                setOrbState("listening");
            },

            onTranscriptUser: (text: string) => {
                // Ignore echo transcriptions during TTS playback
                const currentOrbState = useChatStore.getState().orbState;
                if (currentOrbState === "speaking") return;

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
                isAssistantResponding.current = true;
                // Update message only if it's already been added to chat
                if (edgeTtsMessageShown.current) {
                    updateLastAssistantMessage({ content: accumulated });
                }
            },

            onAudioStart: () => {
                isServerResponseActive.current = true;
                setOrbState("speaking");
            },

            onUserSpeechStarted: () => {
                setOrbState("listening");

                // Barge-in: if the assistant is currently speaking — stop it
                if (isAssistantResponding.current) {
                    // 1. Stop all TTS providers
                    stopEdgeTTS();
                    if ("speechSynthesis" in window) {
                        window.speechSynthesis.cancel();
                    }
                    if (browserTtsWatchdogRef.current) {
                        clearTimeout(browserTtsWatchdogRef.current);
                        browserTtsWatchdogRef.current = null;
                    }
                    if (browserTtsKeepAliveRef.current) {
                        clearInterval(browserTtsKeepAliveRef.current);
                        browserTtsKeepAliveRef.current = null;
                    }
                    // 2. Cancel the current response on OpenAI Realtime API
                    //    (only if server is still streaming — avoid errors on completed responses)
                    if (isServerResponseActive.current) {
                        clientRef.current?.cancelCurrentResponse();
                    }
                    // 3. Reset response cycle state
                    resetResponseState();
                }
            },

            onUserSpeechStopped: () => {
                setOrbState("thinking");
            },

            onAudioEnd: () => {
                // Server finished generating text — TTS playback is local from here
                isServerResponseActive.current = false;

                // Detect counter type from AI response
                const counterType = detectCounterType(
                    lastAssistantText.current,
                );

                // Save text before TTS starts
                const savedText = lastAssistantText.current;
                const aiText = counterType
                    ? stripCounterTag(savedText)
                    : savedText;

                // ── TTS: speak the response ──
                if (savedText) {
                    const textToSpeak = counterType
                        ? stripCounterTag(savedText)
                        : savedText;

                    // Add message to chat (unified for both providers)
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
                    if (counterType) {
                        useAnimationStore.getState().triggerAnimation(counterType);
                    }

                    // Launch TTS by current provider
                    const currentTtsProvider = useSettingsStore.getState().ttsProvider;

                    if (currentTtsProvider === "edge") {
                        setOrbState("speaking");
                        void speakEdgeTTS(textToSpeak, () => {
                            resetResponseState();
                            setOrbState("listening");
                        }, edgeTtsAudioEl);
                    } else if (currentTtsProvider === "yandex") {
                        // Yandex SpeechKit: fetch from /api/tts-yandex, play via blob
                        setOrbState("speaking");
                        void (async () => {
                            try {
                                const res = await fetch("/api/tts-yandex", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ text: textToSpeak }),
                                });
                                if (!res.ok) throw new Error(`Yandex TTS: ${res.status}`);
                                const blob = await res.blob();
                                const url = URL.createObjectURL(blob);
                                const audio = edgeTtsAudioEl ?? new Audio();
                                audio.src = url;
                                audio.onended = () => {
                                    URL.revokeObjectURL(url);
                                    resetResponseState();
                                    setOrbState("listening");
                                };
                                await audio.play().catch(() => {
                                    resetResponseState();
                                    setOrbState("listening");
                                });
                            } catch {
                                resetResponseState();
                                setOrbState("listening");
                            }
                        })();
                    } else {
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
                                resetResponseState();
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
                                resetResponseState();
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
                            resetResponseState();
                            clientRef.current?.unmuteMic();
                            setOrbState("listening");
                        }
                    }
                } else {
                    // No text to speak — reset immediately
                    resetResponseState();
                    setOrbState("listening");
                }

                // ── Auto-send to Obsidian (fire-and-forget) ──
                if (aiText) {
                    const msgs = useChatStore.getState().messages;
                    const lastUser = [...msgs]
                        .reverse()
                        .find((m) => m.role === "user");
                    if (lastUser) {
                        sendToObsidian(lastUser.content, aiText, userId).catch(
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

            // Append user's Obsidian vault notes (server-side, per-user)
            try {
                const vaultRes = await fetch("/api/vault-context", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userId }),
                });
                if (vaultRes.ok) {
                    const vaultData = (await vaultRes.json()) as { context?: string };
                    if (vaultData.context) {
                        voiceContext += "\n--- OBSIDIAN NOTES ---\n" + vaultData.context + "\n--- END NOTES ---";
                    }
                }
            } catch {
                // Vault read failed silently
            }

            // Warm up speechSynthesis during active user gesture (required by Chrome)
            if ("speechSynthesis" in window) {
                const warmup = new SpeechSynthesisUtterance(" ");
                warmup.volume = 0;
                window.speechSynthesis.cancel();
                window.speechSynthesis.speak(warmup);
            }

            await client.start(voiceContext, useEdge);
            setIsVoiceActive(true);

            // Start Web Speech API for real-time transcription display
            startRecognition();

            const rlog = createRemoteLogger(userId, "voice");
            rlog.info("Voice session started", { ttsProvider: useEdge ? "edge" : useSettingsStore.getState().ttsProvider });

            // Start audio level metering loop for orb visualization
            const getTtsLevel = (): number => {
                if (!ttsAnalyserRef.current || !ttsAnalyserDataRef.current) return 0;
                ttsAnalyserRef.current.getByteFrequencyData(ttsAnalyserDataRef.current);
                let sum = 0;
                for (let i = 0; i < ttsAnalyserDataRef.current.length; i++) {
                    sum += ttsAnalyserDataRef.current[i];
                }
                return Math.min(sum / (ttsAnalyserDataRef.current.length * 128), 1);
            };
            const meterLoop = () => {
                const orbSt = useChatStore.getState().orbState;
                if (orbSt === "speaking") {
                    // During TTS playback, read volume from TTS audio
                    setAudioLevel(getTtsLevel());
                } else if (clientRef.current) {
                    // Otherwise read mic volume
                    setAudioLevel(clientRef.current.getAudioLevel());
                }
                audioLevelRafRef.current = requestAnimationFrame(meterLoop);
            };
            audioLevelRafRef.current = requestAnimationFrame(meterLoop);
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : "Unknown error";
            logger.error("Failed to start voice session:", errMsg);
            createRemoteLogger(userId, "voice").error(`Session start failed: ${errMsg}`);
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
