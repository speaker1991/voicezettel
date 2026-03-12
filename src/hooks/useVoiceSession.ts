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
import { extractPreferences, stripPrefTag } from "@/lib/detectPreference";
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

    // Web Speech API for real-time character-by-character transcription
    const { start: startRecognition, stop: stopRecognition } = useSpeechRecognition();

    // Track the current AI response cycle
    const isAssistantResponding = useRef(false);
    const isServerResponseActive = useRef(false); // true while OpenAI is streaming text, false after response.text.done
    const userTranscriptReceived = useRef(false);
    const lastAssistantText = useRef("");
    const edgeTtsMessageShown = useRef(false);
    const pendingUserMsgId = useRef<string | null>(null); // placeholder user message ID
    const browserTtsWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const browserTtsKeepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const audioLevelRafRef = useRef<number | null>(null);
    const ttsAudioCtxRef = useRef<AudioContext | null>(null);
    const ttsAnalyserRef = useRef<AnalyserNode | null>(null);
    const ttsAnalyserDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
    const ttsWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Single source of truth for resetting response cycle state
    const resetResponseState = useCallback(() => {
        isAssistantResponding.current = false;
        isServerResponseActive.current = false;
        // Unmute mic after TTS finished (echo prevention)
        clientRef.current?.unmuteMic();
        clientRef.current?.softUnmuteMic();
        userTranscriptReceived.current = false;
        lastAssistantText.current = "";
        edgeTtsMessageShown.current = false;
        pendingUserMsgId.current = null;
        if (ttsWatchdogRef.current) {
            clearTimeout(ttsWatchdogRef.current);
            ttsWatchdogRef.current = null;
        }
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
                // Warm up speechSynthesis when switching to browser TTS
                // (mobile requires user gesture to unlock speechSynthesis)
                const newProvider = useSettingsStore.getState().ttsProvider;
                if (newProvider === "browser" && "speechSynthesis" in window) {
                    const warmup = new SpeechSynthesisUtterance(" ");
                    warmup.volume = 0;
                    window.speechSynthesis.cancel();
                    window.speechSynthesis.speak(warmup);
                }
            },
        );
        return () => unsub();
    }, [stopEdgeTTS, resetResponseState, setOrbState]);

    const startVoice = useCallback(async () => {
        if (clientRef.current) return;

        const ttsProvider = useSettingsStore.getState().ttsProvider;
        // OpenAI TTS = use native audio (muteAudio=false), all others = external TTS (muteAudio=true)
        const useExternalTts = ttsProvider !== "openai";

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
                // Whisper finished — update the placeholder with accurate text
                userTranscriptReceived.current = true;

                if (pendingUserMsgId.current) {
                    useChatStore.getState().updateMessageById(
                        pendingUserMsgId.current,
                        { content: text },
                    );
                    // Don't clear pendingUserMsgId here — Whisper may fire multiple
                    // times. It gets cleared in resetResponseState() at end of cycle.
                } else {
                    // Fallback: no placeholder (shouldn't happen), add directly
                    addMessage({
                        id: crypto.randomUUID(),
                        role: "user" as const,
                        content: text,
                        timestamp: new Date().toISOString(),
                        source: "voice" as const,
                    });
                }
            },

            onTranscriptAssistant: (accumulated: string) => {
                lastAssistantText.current = accumulated;
                isAssistantResponding.current = true;
                if (edgeTtsMessageShown.current) {
                    updateLastAssistantMessage({ content: accumulated });
                }
            },

            onAudioStart: () => {
                isServerResponseActive.current = true;
                setOrbState("speaking");
                // Soft-mute mic to prevent echo (model hearing itself)
                clientRef.current?.softMuteMic();
            },

            onUserSpeechStarted: () => {
                setOrbState("listening");

                // Barge-in — only for external TTS
                // OpenAI native TTS handles interruptions via WebRTC natively
                const currentTts = useSettingsStore.getState().ttsProvider;
                if (currentTts === "openai") return;

                if (isAssistantResponding.current) {
                    stopEdgeTTS();
                    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
                    if (browserTtsWatchdogRef.current) {
                        clearTimeout(browserTtsWatchdogRef.current);
                        browserTtsWatchdogRef.current = null;
                    }
                    if (browserTtsKeepAliveRef.current) {
                        clearInterval(browserTtsKeepAliveRef.current);
                        browserTtsKeepAliveRef.current = null;
                    }
                    if (isServerResponseActive.current) {
                        clientRef.current?.cancelCurrentResponse();
                    }
                    resetResponseState();
                }
            },

            onUserSpeechStopped: () => {
                setOrbState("thinking");

                // Grab SpeechRecognition text before clearing the bubble
                const currentText = useChatStore.getState().liveTranscript || "...";
                setLiveTranscript(""); // hide bubble

                // Create user message immediately with SpeechRecognition text
                // → bubble disappears but SAME text appears as chat message (no jump)
                // → message is created BEFORE GPT responds (correct order)
                if (!pendingUserMsgId.current) {
                    const id = crypto.randomUUID();
                    pendingUserMsgId.current = id;
                    addMessage({
                        id,
                        role: "user" as const,
                        content: currentText,
                        timestamp: new Date().toISOString(),
                        source: "voice" as const,
                    });
                }
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

                // Detect and save behavior preferences
                const prefs = extractPreferences(savedText);
                if (prefs.length > 0) {
                    for (const rule of prefs) {
                        void fetch("/api/preferences", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ userId, rule }),
                        }).catch(() => { /* silent */ });
                    }
                    // Live update: re-fetch all rules and update session immediately
                    void (async () => {
                        try {
                            const prefRes = await fetch(`/api/preferences?userId=${encodeURIComponent(userId)}`);
                            if (prefRes.ok) {
                                const prefData = (await prefRes.json()) as { rules: string[]; profile: string | null };
                                if (clientRef.current) {
                                    // Prefer condensed profile over individual rules
                                    const rulesText = prefData.profile
                                        ?? prefData.rules.map((r: string, i: number) => `${i + 1}. ${r}`).join("\n");
                                    if (rulesText) clientRef.current.setBehaviorRules(rulesText);
                                }
                            }
                        } catch { /* silent */ }
                    })();
                }

                // Strip both COUNTER and SAVE_PREF tags from visible text
                let cleanText = savedText;
                if (counterType) cleanText = stripCounterTag(cleanText);
                cleanText = stripPrefTag(cleanText);
                // Strip JSON wrappers that gpt-realtime-1.5 adds: {"text"} or {"text}
                cleanText = cleanText.replace(/^\{["']?\s*/, "").replace(/\s*["']?\}$/, "");
                // Strip leading/trailing quotes
                cleanText = cleanText.replace(/^["']+|["']+$/g, "");
                // Clean literal \n artifacts and trim whitespace
                cleanText = cleanText.replace(/\\n/g, "\n").trim();
                const aiText = cleanText;

                // ── TTS: speak the response ──
                if (savedText) {
                    // Clean text for TTS (no internal tags)
                    const textToSpeak = cleanText;

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

                    if (currentTtsProvider === "openai") {
                        // OpenAI native TTS — audio plays from audioEl automatically
                        // response.audio.done = audio finished → reset to listening
                        setOrbState("speaking");
                        // Small delay to let audioEl buffer finish playing
                        setTimeout(() => {
                            resetResponseState();
                            setOrbState("listening");
                        }, 500);
                    } else {
                        // External TTS — mute mic to prevent echo
                        clientRef.current?.muteMic();
                    }

                    if (currentTtsProvider === "edge") {
                        setOrbState("speaking");
                        // Watchdog: force-reset if TTS stalls
                        ttsWatchdogRef.current = setTimeout(() => {
                            stopEdgeTTS();
                            resetResponseState();
                            setOrbState("listening");
                        }, 30000);
                        void speakEdgeTTS(textToSpeak, () => {
                            resetResponseState();
                            setOrbState("listening");
                        }, edgeTtsAudioEl);
                    } else if (currentTtsProvider === "yandex") {
                        // Yandex SpeechKit: fetch from /api/tts-yandex, play via blob
                        setOrbState("speaking");
                        // Watchdog for Yandex TTS
                        ttsWatchdogRef.current = setTimeout(() => {
                            resetResponseState();
                            setOrbState("listening");
                        }, 30000);
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

                            const doSpeak = () => {
                                const utterance = new SpeechSynthesisUtterance(textToSpeak);
                                utterance.lang = "ru-RU";
                                utterance.rate = 1.0;
                                utterance.pitch = 1.0;

                                // Try to find a Russian voice explicitly
                                const voices = window.speechSynthesis.getVoices();
                                const ruVoice = voices.find((v) => v.lang.startsWith("ru"));
                                if (ruVoice) {
                                    utterance.voice = ruVoice;
                                }

                                // Watchdog: force-reset if onend doesn't fire
                                const watchdogMs = Math.max(5000, textToSpeak.length * 100);
                                browserTtsWatchdogRef.current = setTimeout(() => {
                                    window.speechSynthesis.cancel();
                                    resetResponseState();
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
                                    setOrbState("listening");
                                };

                                utterance.onend = cleanup;
                                utterance.onerror = (e) => {
                                    logger.warn("Browser TTS error:", e);
                                    cleanup();
                                };

                                window.speechSynthesis.speak(utterance);
                            };

                            // Voices may not be loaded yet — wait for them
                            const voices = window.speechSynthesis.getVoices();
                            if (voices.length === 0) {
                                // Voices not loaded — wait for voiceschanged event
                                const onVoicesReady = () => {
                                    window.speechSynthesis.removeEventListener("voiceschanged", onVoicesReady);
                                    doSpeak();
                                };
                                window.speechSynthesis.addEventListener("voiceschanged", onVoicesReady);
                                // Fallback: if voiceschanged never fires, try anyway after 500ms
                                setTimeout(() => {
                                    window.speechSynthesis.removeEventListener("voiceschanged", onVoicesReady);
                                    doSpeak();
                                }, 500);
                            } else {
                                doSpeak();
                            }

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
                    "gpt-realtime-1.5",
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

            // Load saved behavior rules (injected at TOP of prompt via setBehaviorRules)
            let savedBehaviorRules = "";
            try {
                const prefRes = await fetch(`/api/preferences?userId=${encodeURIComponent(userId)}`);
                if (prefRes.ok) {
                    const prefData = (await prefRes.json()) as { rules: string[]; profile: string | null };
                    // Prefer condensed profile over individual rules
                    savedBehaviorRules = prefData.profile
                        ?? (prefData.rules.length > 0
                            ? prefData.rules.map((r, i) => `${i + 1}. ${r}`).join("\n")
                            : "");
                }
            } catch {
                // Silent
            }

            // Warm up speechSynthesis during active user gesture (required by Chrome)
            if ("speechSynthesis" in window) {
                const warmup = new SpeechSynthesisUtterance(" ");
                warmup.volume = 0;
                window.speechSynthesis.cancel();
                window.speechSynthesis.speak(warmup);
            }

            await client.start(voiceContext, useExternalTts);
            if (savedBehaviorRules) {
                client.setBehaviorRules(savedBehaviorRules);
            }
            setIsVoiceActive(true);

            // Start Web Speech API for real-time character-by-character transcription
            startRecognition();
            const rlog = createRemoteLogger(userId, "voice");
            rlog.info("Voice session started", { ttsProvider: useExternalTts ? useSettingsStore.getState().ttsProvider : "openai" });

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
