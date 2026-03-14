"use client";

import { useRef, useCallback, useState, useEffect } from "react";
import {
    LocalVoiceClient,
    type LocalVoiceCallbacks,
} from "@/lib/localVoiceClient";
import { YandexSttClient } from "@/lib/yandexSttClient";
import { BrowserSttClient } from "@/lib/browserSttClient";
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
    AsyncQueue,
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
    const clientRef = useRef<LocalVoiceClient | YandexSttClient | BrowserSttClient | null>(null);
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
            if (!audioEl) {
                console.warn("[TTS] No audio element, skipping playback");
                resolve();
                return;
            }

            // Ensure AudioContext is running (browser autoplay policy)
            if (ttsAudioCtxRef.current?.state === "suspended") {
                console.log("[TTS] Resuming suspended AudioContext...");
                ttsAudioCtxRef.current.resume().catch(() => { /* silent */ });
            }

            const url = URL.createObjectURL(blob);
            audioEl.src = url;
            audioEl.volume = 1.0;
            console.log("[TTS] Playing blob:", blob.size, "bytes");

            const done = () => {
                URL.revokeObjectURL(url);
                console.log("[TTS] Playback done");
                resolve();
            };

            audioEl.onended = done;
            audioEl.onerror = (e) => {
                console.error("[TTS] Audio playback error:", e);
                done();
            };

            const wd = setTimeout(() => {
                console.warn("[TTS] Playback watchdog fired (20s)");
                audioEl.pause();
                done();
            }, 20000);

            audioEl.play().then(() => {
                console.log("[TTS] Play started, duration:", audioEl.duration);
                audioEl.onended = () => { clearTimeout(wd); done(); };
            }).catch((err) => {
                console.error("[TTS] play() rejected:", err);
                clearTimeout(wd);
                done();
            });
        });
    }, []);

    // ── Process one voice cycle ──
    const processVoiceCycle = useCallback(async (userText: string) => {
        if (isProcessingRef.current) return;
        isProcessingRef.current = true;

        const queue = new AsyncQueue<SentenceJob>();

        const runPlayer = async () => {
            setOrbState("speaking");
            let count = 0;
            for await (const job of queue) {
                count++;
                console.log(`[TTS] Playing sentence #${count}: "${job.text.slice(0, 40)}..."`);
                const blob = await job.blobPromise;
                if (blob && blob.size > 0) {
                    await playBlob(blob);
                } else if (job.text.length > 2 && "speechSynthesis" in window) {
                    // Fallback: use browser native TTS if EdgeTTS returned nothing
                    console.warn(`[TTS] Sentence #${count} got null/empty blob — falling back to speechSynthesis`);
                    const { speakWithBrowserTTS } = await import("@/hooks/voiceHelpers");
                    await speakWithBrowserTTS(job.text);
                } else {
                    console.warn(`[TTS] Sentence #${count} got null/empty blob, no fallback available`);
                }
            }
            console.log(`[TTS] Player done, played ${count} sentences`);
        };

        const voice = useSettingsStore.getState().edgeTtsVoice;

        try {
            addMessage({ id: crypto.randomUUID(), role: "user", content: userText, timestamp: new Date().toISOString(), source: "voice" });
            setOrbState("thinking");
            // No muteMic — barge-in is allowed
            addMessage({ id: crypto.randomUUID(), role: "assistant", content: "", timestamp: new Date().toISOString(), source: "voice" });

            const playerPromise = runPlayer();

            const rawResponse = await sendToChat(userText, (sentence: string) => {
                let clean = sentence;
                clean = clean.replace(/<\s*\|?\s*(?:DSML|function_calls?|antml|invoke|parameter)[^>]*>[\s\S]*?(?:<\s*\/[^>]*>|$)/gi, "");
                clean = clean.trim();
                console.log("[TTS] Sentence detected:", clean.slice(0, 50), "length:", clean.length);
                if (clean.length < 3) return;
                queue.push({ text: clean, blobPromise: prefetchEdgeTTS(clean, voice) });
            });
            console.log("[TTS] Stream finished, raw response length:", rawResponse.length);

            queue.finish();
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
            queue.finish();
            isProcessingRef.current = false;
            // No unmuteMic — mic stays open for barge-in
            if (clientRef.current) setOrbState("listening");
        }
    }, [userId, addMessage, updateLastAssistantMessage, setOrbState, sendToChat, playBlob]);

    // ── Hot-swap TTS provider or voice ──
    useEffect(() => {
        const onSwap = () => {
            cleanupTTS();
            if ("speechSynthesis" in window) {
                const warmup = new SpeechSynthesisUtterance(" ");
                warmup.volume = 0;
                window.speechSynthesis.cancel();
                window.speechSynthesis.speak(warmup);
            }
        };
        const unsub1 = useSettingsStore.subscribe(
            (s) => s.ttsProvider,
            onSwap,
        );
        const unsub2 = useSettingsStore.subscribe(
            (s) => s.edgeTtsVoice,
            onSwap,
        );
        return () => { unsub1(); unsub2(); };
    }, [cleanupTTS]);

    // ── Start voice session ──
    const startVoice = useCallback(async () => {
        if (clientRef.current) return;

        const voiceMode = useSettingsStore.getState().voiceMode;

        // Determine which STT client to use
        let sttKind: "local" | "browser" | "yandex";
        if (voiceMode === "yandex") {
            const available = await YandexSttClient.isAvailable();
            if (!available) {
                useNotificationStore.getState().addNotification("Yandex STT не настроен. Проверьте YANDEX_OAUTH_TOKEN", "error");
                return;
            }
            sttKind = "yandex";
        } else if (voiceMode === "browser") {
            if (!BrowserSttClient.isAvailable()) {
                useNotificationStore.getState().addNotification("Web Speech API не поддерживается в этом браузере", "error");
                return;
            }
            sttKind = "browser";
        } else {
            // "cloud" or "local" — try Local Core first, fallback to browser
            const localOk = await LocalVoiceClient.isAvailable();
            if (localOk) {
                sttKind = "local";
            } else if (BrowserSttClient.isAvailable()) {
                sttKind = "browser";
                useNotificationStore.getState().addNotification("Local Core не найден — используется браузерный STT", "info");
            } else {
                useNotificationStore.getState().addNotification("Local Core не запущен и браузерный STT недоступен", "error");
                return;
            }
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
            if (ctx.state === "suspended") {
                await ctx.resume();
                console.log("[TTS] AudioContext resumed from suspended state");
            }
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;

            // Try to route audio through AudioContext for visualization
            // If this fails (e.g. on some iOS versions), playback still works via <audio> directly
            try {
                const source = ctx.createMediaElementSource(audioEl);
                source.connect(analyser);
                analyser.connect(ctx.destination);
            } catch {
                console.warn("[Voice] createMediaElementSource failed — TTS will play without visualization");
            }

            ttsAudioCtxRef.current = ctx;
            ttsAnalyserRef.current = analyser;
            ttsAnalyserDataRef.current = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
            console.log("[TTS] AudioContext ready, state:", ctx.state);
        } catch (err) {
            console.warn("[TTS] AudioContext setup failed (non-critical):", err);
        }

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
                const label = sttKind === "yandex" ? "Yandex" : sttKind === "browser" ? "Browser" : "Local";
                if (status === "ready") {
                    logger.info(`[Voice] ${label} STT connected`);
                } else if (status === "error") {
                    logger.error(`[Voice] ${label} STT connection error`);
                    useNotificationStore.getState().addNotification("Ошибка подключения к STT", "error");
                }
            },
            onError: (message: string) => {
                logger.error("[Voice] Error:", message);
                useNotificationStore.getState().addNotification(`Голос: ${message}`, "error");
            },
        };

        let client: LocalVoiceClient | YandexSttClient | BrowserSttClient;
        if (sttKind === "yandex") {
            client = new YandexSttClient(callbacks);
        } else if (sttKind === "browser") {
            client = new BrowserSttClient(callbacks);
        } else {
            client = new LocalVoiceClient(callbacks);
        }
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
            // Only start browser speech recognition as live-transcript overlay for non-browser STT
            if (sttKind !== "browser") startRecognition();

            const micStream = client.getStream();
            if (micStream) {
                try {
                    // Reuse TTS AudioContext instead of creating another one (iOS has limits)
                    const ctx = ttsAudioCtxRef.current ?? new AudioContext();
                    if (ctx.state === "suspended") {
                        await ctx.resume();
                    }
                    const micSource = ctx.createMediaStreamSource(micStream);
                    const micAnalyser = ctx.createAnalyser();
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

            const labels = { local: "Local", browser: "Browser", yandex: "Yandex" };
            logger.info(`[Voice] Session started (${labels[sttKind]} STT + LLM + EdgeTTS sentence streaming)`);
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
