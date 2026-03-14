"use client";

import { useRef, useCallback, useState, useEffect } from "react";
import {
    LocalVoiceClient,
    type LocalVoiceCallbacks,
} from "@/lib/localVoiceClient";
import { useChatStore } from "@/stores/chatStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useAnimationStore } from "@/stores/animationStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { detectCounterTypes } from "@/lib/detectCounterType";
import { extractPreferences } from "@/lib/detectPreference";
import { sendToObsidian } from "@/lib/obsidianClient";
import { useUser } from "@/components/providers/UserProvider";
import { logger } from "@/lib/logger";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useChatStream } from "@/hooks/useChatStream";
import {
    type SentenceJob,
    prefetchEdgeTTS,
    cleanResponseText,
    getAudioLevel,
} from "@/hooks/voiceHelpers";

/**
 * useVoiceSession — Local STT (faster-whisper GPU) + any LLM + sentence-streaming EdgeTTS.
 *
 * Flow: Mic → WebSocket → faster-whisper → /api/chat (stream) → EdgeTTS per sentence
 */
export function useVoiceSession() {
    const clientRef = useRef<LocalVoiceClient | null>(null);
    const [isVoiceActive, setIsVoiceActive] = useState(false);
    const { userId } = useUser();

    const addMessage = useChatStore((s) => s.addMessage);
    const updateLastAssistantMessage = useChatStore((s) => s.updateLastAssistantMessage);
    const setOrbState = useChatStore((s) => s.setOrbState);
    const setModality = useChatStore((s) => s.setModality);
    const setAudioLevel = useChatStore((s) => s.setAudioLevel);
    const setLiveTranscript = useChatStore((s) => s.setLiveTranscript);

    // Sub-hooks
    const { sendToChat, abort: abortChat, abortRef } = useChatStream();
    const { start: startRecognition, stop: stopRecognition } = useSpeechRecognition();

    // Refs for audio
    const isProcessingRef = useRef(false);
    const edgeTtsAudioElRef = useRef<HTMLAudioElement | null>(null);
    const ttsAudioCtxRef = useRef<AudioContext | null>(null);
    const ttsAnalyserRef = useRef<AnalyserNode | null>(null);
    const ttsAnalyserDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
    const audioLevelRafRef = useRef<number | null>(null);
    const micAnalyserRef = useRef<AnalyserNode | null>(null);
    const micAnalyserDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
    const browserTtsWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const browserTtsKeepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // ── Cleanup TTS ──
    const cleanupTTS = useCallback(() => {
        const audioEl = edgeTtsAudioElRef.current;
        if (audioEl) {
            audioEl.pause();
            audioEl.removeAttribute("src");
            audioEl.load();
        }
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
    }, []);

    // ── Play a single audio blob ──
    const playBlob = useCallback((blob: Blob): Promise<void> => {
        return new Promise<void>((resolve) => {
            const audioEl = edgeTtsAudioElRef.current;
            if (!audioEl) { resolve(); return; }

            const url = URL.createObjectURL(blob);
            audioEl.src = url;
            const done = () => { URL.revokeObjectURL(url); resolve(); };

            audioEl.onended = done;
            audioEl.onerror = done;

            const wd = setTimeout(() => { audioEl.pause(); done(); }, 20000);
            audioEl.play().then(() => {
                audioEl.onended = () => { clearTimeout(wd); done(); };
            }).catch(() => { clearTimeout(wd); done(); });
        });
    }, []);

    // ── Process one voice cycle ──
    const processVoiceCycle = useCallback(async (userText: string) => {
        if (isProcessingRef.current) return;
        isProcessingRef.current = true;

        const queue: SentenceJob[] = [];
        let streamDone = false;
        let playerRunning = false;

        const runPlayer = async () => {
            if (playerRunning) return;
            playerRunning = true;
            setOrbState("speaking");

            while (queue.length > 0 || !streamDone) {
                if (queue.length === 0) {
                    await new Promise((r) => setTimeout(r, 50));
                    continue;
                }
                const job = queue.shift()!;
                const blob = await job.blobPromise;
                if (blob && blob.size > 0) await playBlob(blob);
            }
            playerRunning = false;
        };

        const voice = useSettingsStore.getState().edgeTtsVoice;

        try {
            addMessage({ id: crypto.randomUUID(), role: "user", content: userText, timestamp: new Date().toISOString(), source: "voice" });
            setOrbState("thinking");
            clientRef.current?.muteMic();
            addMessage({ id: crypto.randomUUID(), role: "assistant", content: "", timestamp: new Date().toISOString(), source: "voice" });

            const playerPromise = (async () => {
                while (queue.length === 0 && !streamDone) {
                    await new Promise((r) => setTimeout(r, 30));
                }
                await runPlayer();
            })();

            const rawResponse = await sendToChat(userText, (sentence: string) => {
                let clean = sentence;
                clean = clean.replace(/<\s*\|?\s*(?:DSML|function_calls?|antml|invoke|parameter)[^>]*>[\s\S]*?(?:<\s*\/[^>]*>|$)/gi, "");
                clean = clean.trim();
                if (clean.length < 3) return;
                queue.push({ text: clean, blobPromise: prefetchEdgeTTS(clean, voice) });
            });

            streamDone = true;
            await playerPromise;

            const cleanText = cleanResponseText(rawResponse);
            updateLastAssistantMessage({ content: cleanText });

            // Counters & preferences
            const counterTypes = detectCounterTypes(rawResponse);
            for (const ct of counterTypes) {
                useAnimationStore.getState().triggerAnimation(ct);
            }
            const prefs = extractPreferences(rawResponse);
            if (prefs.length > 0) {
                for (const rule of prefs) {
                    void fetch("/api/preferences", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ userId, rule }),
                    }).catch(() => { /* silent */ });
                }
            }

            sendToObsidian(userText, cleanText, userId).catch(() => { /* silent */ });

            fetch("/api/voice-memory", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId, userText, assistantText: cleanText }),
            }).catch(() => { /* silent */ });

        } catch (err) {
            if ((err as Error).name !== "AbortError") {
                logger.error("Voice cycle error:", (err as Error).message);
                useNotificationStore.getState().addNotification(`Ошибка: ${(err as Error).message}`, "error");
            }
        } finally {
            streamDone = true;
            isProcessingRef.current = false;
            clientRef.current?.unmuteMic();
            if (clientRef.current) setOrbState("listening");
        }
    }, [userId, addMessage, updateLastAssistantMessage, setOrbState, sendToChat, playBlob]);

    // ── Hot-swap TTS provider ──
    useEffect(() => {
        const unsub = useSettingsStore.subscribe(
            (s) => s.ttsProvider,
            () => {
                cleanupTTS();
                if ("speechSynthesis" in window) {
                    const warmup = new SpeechSynthesisUtterance(" ");
                    warmup.volume = 0;
                    window.speechSynthesis.cancel();
                    window.speechSynthesis.speak(warmup);
                }
            },
        );
        return () => unsub();
    }, [cleanupTTS]);

    // ── Start voice session ──
    const startVoice = useCallback(async () => {
        if (clientRef.current) return;

        const available = await LocalVoiceClient.isAvailable();
        if (!available) {
            useNotificationStore.getState().addNotification("Local Core не запущен. Запустите local_core: python main.py", "error");
            return;
        }

        setModality("voice");
        setOrbState("listening");

        const audioEl = document.createElement("audio");
        audioEl.setAttribute("playsinline", "true");
        audioEl.style.display = "none";
        document.body.appendChild(audioEl);
        edgeTtsAudioElRef.current = audioEl;

        try {
            const ctx = new AudioContext();
            const source = ctx.createMediaElementSource(audioEl);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            analyser.connect(ctx.destination);
            ttsAudioCtxRef.current = ctx;
            ttsAnalyserRef.current = analyser;
            ttsAnalyserDataRef.current = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
        } catch { /* Non-critical */ }

        let interimText = "";

        const callbacks: LocalVoiceCallbacks = {
            onTranscriptUser: (text: string, isFinal: boolean) => {
                if (isFinal && text.trim().length > 0) {
                    setLiveTranscript("");
                    void processVoiceCycle(text.trim());
                } else if (!isFinal) {
                    interimText = text;
                    setLiveTranscript(text);
                }
            },
            onUserSpeechStarted: () => {
                interimText = "";
                if (isProcessingRef.current) {
                    abortRef.current?.abort();
                    cleanupTTS();
                    isProcessingRef.current = false;
                }
                if (!isProcessingRef.current) setOrbState("listening");
            },
            onUserSpeechStopped: () => {
                if (!isProcessingRef.current && interimText.trim()) setOrbState("thinking");
            },
            onStatusChange: (status) => {
                if (status === "ready") {
                    logger.info("[Voice] Local STT connected");
                } else if (status === "error") {
                    logger.error("[Voice] STT connection error");
                    useNotificationStore.getState().addNotification("Ошибка подключения к STT", "error");
                }
            },
            onError: (message: string) => {
                logger.error("[Voice] Error:", message);
                useNotificationStore.getState().addNotification(`Голос: ${message}`, "error");
            },
        };

        const client = new LocalVoiceClient(callbacks);
        clientRef.current = client;

        try {
            if ("speechSynthesis" in window) {
                const warmup = new SpeechSynthesisUtterance(" ");
                warmup.volume = 0;
                window.speechSynthesis.cancel();
                window.speechSynthesis.speak(warmup);
            }

            await client.start();
            setIsVoiceActive(true);
            startRecognition();

            const micStream = client.getStream();
            if (micStream) {
                try {
                    const micCtx = new AudioContext();
                    const micSource = micCtx.createMediaStreamSource(micStream);
                    const micAnalyser = micCtx.createAnalyser();
                    micAnalyser.fftSize = 256;
                    micSource.connect(micAnalyser);
                    micAnalyserRef.current = micAnalyser;
                    micAnalyserDataRef.current = new Uint8Array(micAnalyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
                } catch { /* Non-critical */ }
            }

            const meterLoop = () => {
                const orbSt = useChatStore.getState().orbState;
                if (orbSt === "speaking") {
                    setAudioLevel(getAudioLevel(ttsAnalyserRef.current, ttsAnalyserDataRef.current));
                } else if (orbSt === "listening") {
                    setAudioLevel(getAudioLevel(micAnalyserRef.current, micAnalyserDataRef.current));
                } else {
                    setAudioLevel(0.05);
                }
                audioLevelRafRef.current = requestAnimationFrame(meterLoop);
            };
            audioLevelRafRef.current = requestAnimationFrame(meterLoop);

            logger.info("[Voice] Session started (Local STT + LLM + EdgeTTS sentence streaming)");
        } catch (err) {
            logger.error("Failed to start voice:", err instanceof Error ? err.message : err);
            useNotificationStore.getState().addNotification(`Не удалось запустить голос: ${err instanceof Error ? err.message : "Ошибка"}`, "error");
            clientRef.current = null;
            setOrbState("idle");
            setModality("text");
        }
    }, [setOrbState, setModality, setAudioLevel, setLiveTranscript, processVoiceCycle, cleanupTTS, startRecognition, abortRef]);

    // ── Stop voice session ──
    const stopVoice = useCallback(() => {
        if (clientRef.current) {
            clientRef.current.stop();
            clientRef.current = null;
        }
        abortChat();
        cleanupTTS();
        stopRecognition();
        setLiveTranscript("");

        if (edgeTtsAudioElRef.current) {
            edgeTtsAudioElRef.current.remove();
            edgeTtsAudioElRef.current = null;
        }

        if (audioLevelRafRef.current !== null) {
            cancelAnimationFrame(audioLevelRafRef.current);
            audioLevelRafRef.current = null;
        }
        setAudioLevel(0);

        if (ttsAudioCtxRef.current) {
            ttsAudioCtxRef.current.close().catch(() => { /* silent */ });
            ttsAudioCtxRef.current = null;
            ttsAnalyserRef.current = null;
            ttsAnalyserDataRef.current = null;
        }

        isProcessingRef.current = false;
        setIsVoiceActive(false);
        setOrbState("idle");
        setModality("text");
    }, [setOrbState, setModality, setAudioLevel, setLiveTranscript, cleanupTTS, stopRecognition, abortChat]);

    return { isVoiceActive, startVoice, stopVoice } as const;
}
