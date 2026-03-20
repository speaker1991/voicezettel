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
    prefetchLocalTTS,
    prefetchPiperTTS,
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
    const isSpeakingRef = useRef(false);
    const edgeTtsAudioElRef = useRef<HTMLAudioElement | null>(null);
    const micAudioCtxRef = useRef<AudioContext | null>(null);
    const audioLevelRafRef = useRef<number | null>(null);
    const micAnalyserRef = useRef<AnalyserNode | null>(null);
    const micAnalyserDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
    const browserTtsWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const browserTtsKeepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const playbackResolveRef = useRef<(() => void) | null>(null);
    const activeQueueRef = useRef<AsyncQueue<SentenceJob> | null>(null);
    const bargeInRafRef = useRef<number | null>(null);

    // ── Cleanup TTS ──
    const cleanupTTS = useCallback(() => {
        // Stop barge-in detector
        if (bargeInRafRef.current) {
            cancelAnimationFrame(bargeInRafRef.current);
            bargeInRafRef.current = null;
        }
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
        // Resolve any pending playBlob — unblocks runPlayer immediately on barge-in
        if (playbackResolveRef.current) {
            playbackResolveRef.current();
            playbackResolveRef.current = null;
        }
    }, []);

    // ── Mic-level barge-in detector ──
    // Runs via rAF while TTS is playing. Uses AnalyserNode (independent of
    // Whisper/STT) to detect user speaking at >THRESHOLD for HOLD_MS.
    const startBargeInDetector = useCallback(() => {
        const THRESHOLD = 0.18;
        const HOLD_MS = 800;  // increased from 300 to avoid false barge-in on residual voice noise
        let holdStart: number | null = null;

        const check = () => {
            if (!isSpeakingRef.current) {
                bargeInRafRef.current = null;
                return;
            }

            const level = getAudioLevel(
                micAnalyserRef.current,
                micAnalyserDataRef.current,
            );

            if (level > THRESHOLD) {
                if (holdStart === null) holdStart = Date.now();
                if (Date.now() - holdStart >= HOLD_MS) {
                    console.log("[Voice] Barge-in: mic level", level.toFixed(2), "held", HOLD_MS, "ms");
                    abortRef.current?.abort();
                    cleanupTTS();
                    isSpeakingRef.current = false;
                    isProcessingRef.current = false;
                    if (activeQueueRef.current) {
                        activeQueueRef.current.finish();
                        activeQueueRef.current = null;
                    }
                    const cli = clientRef.current;
                    if (cli && "unmuteMic" in cli) {
                        (cli as { unmuteMic: () => void }).unmuteMic();
                    }
                    setOrbState("listening");
                    bargeInRafRef.current = null;
                    return;
                }
            } else {
                holdStart = null;
            }

            bargeInRafRef.current = requestAnimationFrame(check);
        };

        bargeInRafRef.current = requestAnimationFrame(check);
    }, [cleanupTTS, setOrbState, abortRef]);

    // ── Play a single audio blob ──
    const playBlob = useCallback((blob: Blob): Promise<void> => {
        return new Promise<void>((resolve) => {
            const audioEl = edgeTtsAudioElRef.current;
            if (!audioEl) {
                console.warn("[TTS] No audio element, skipping playback");
                resolve();
                return;
            }

            // Store resolve so cleanupTTS can unblock us on barge-in
            playbackResolveRef.current = resolve;

            const url = URL.createObjectURL(blob);
            audioEl.src = url;
            audioEl.volume = 1.0;
            console.log("[TTS] Playing blob:", blob.size, "bytes");

            let resolved = false;
            const done = () => {
                if (resolved) return;
                resolved = true;
                audioEl.ontimeupdate = null;
                URL.revokeObjectURL(url);
                playbackResolveRef.current = null;
                console.log("[TTS] Playback done");
                resolve();
            };

            // Simulate audio level for Orb visualization via timeupdate
            audioEl.ontimeupdate = () => {
                if (audioEl.duration > 0 && !audioEl.paused) {
                    const t = audioEl.currentTime * 8;
                    const level = 0.5 + 0.3 * Math.sin(t);
                    setAudioLevel(level);
                }
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
                // Fallback: try creating a new Audio object (works on some iOS versions)
                try {
                    console.log("[TTS] Trying fallback with new Audio()...");
                    const fallbackAudio = new Audio(url);
                    fallbackAudio.volume = 1.0;
                    fallbackAudio.onended = () => { done(); };
                    fallbackAudio.onerror = () => { done(); };
                    fallbackAudio.play().then(() => {
                        console.log("[TTS] Fallback play succeeded");
                    }).catch((e2) => {
                        console.error("[TTS] Fallback also failed:", e2);
                        done();
                    });
                } catch {
                    done();
                }
            });
        });
    }, [setAudioLevel]);

    // ── Process one voice cycle ──
    const processVoiceCycle = useCallback(async (userText: string) => {
        // If already processing — abort the previous cycle and start a new one
        if (isProcessingRef.current) {
            console.log("[Voice] processVoiceCycle: aborting previous cycle for new query");
            abortRef.current?.abort();
            cleanupTTS();
            isSpeakingRef.current = false;
            if (activeQueueRef.current) {
                activeQueueRef.current.finish();
                activeQueueRef.current = null;
            }
            // Let event loop process abort before new start
            await new Promise((r) => setTimeout(r, 50));
        }
        isProcessingRef.current = true;

        const queue = new AsyncQueue<SentenceJob>();
        activeQueueRef.current = queue;

        const runPlayer = async () => {
            setOrbState("speaking");
            isSpeakingRef.current = true;
            // Mute STT results (not the recognition engine!) to prevent self-hearing.
            // Using muteMic instead of pauseRecognition because recognition.stop()
            // kills the iOS audio session and breaks <audio>.play().
            const client = clientRef.current;
            if (client && "muteMic" in client) {
                (client as { muteMic: () => void }).muteMic();
            }
            // Delay barge-in detector start — let TTS begin playing before
            // monitoring mic (avoids false trigger on residual voice echo)
            setTimeout(() => {
                if (isSpeakingRef.current) {
                    startBargeInDetector();
                }
            }, 1200);
            console.log("[TTS] Speaking started — mic muted, barge-in detector delayed 1200ms");
            let count = 0;
            for await (const job of queue) {
                if (!isSpeakingRef.current && queue.isEmpty()) break;
                count++;
                console.log(`[TTS] Playing sentence #${count}: "${job.text.slice(0, 40)}..."`);
                const blob = await job.blobPromise;
                if (!isSpeakingRef.current) break;
                if (blob && blob.size > 0) {
                    await playBlob(blob);
                } else if (job.text.length > 2 && "speechSynthesis" in window) {
                    console.warn(`[TTS] Sentence #${count} got null/empty blob — falling back to speechSynthesis`);
                    const { speakWithBrowserTTS } = await import("@/hooks/voiceHelpers");
                    await speakWithBrowserTTS(job.text);
                } else {
                    console.warn(`[TTS] Sentence #${count} got null/empty blob, no fallback available`);
                }
            }
            console.log(`[TTS] Player done, played ${count} sentences`);
            isSpeakingRef.current = false;
            // Unmute STT after all speaking is done
            const cli = clientRef.current;
            if (cli && "unmuteMic" in cli) {
                (cli as { unmuteMic: () => void }).unmuteMic();
            }
        };

        const { ttsProvider, edgeTtsVoice, localTtsVoice } = useSettingsStore.getState();

        try {
            addMessage({ id: crypto.randomUUID(), role: "user", content: userText, timestamp: new Date().toISOString(), source: "voice" });
            setOrbState("thinking");
            // No muteMic — barge-in is allowed
            addMessage({ id: crypto.randomUUID(), role: "assistant", content: "", timestamp: new Date().toISOString(), source: "voice" });

            const playerPromise = runPlayer();

            const rawResponse = await sendToChat(userText, (sentence: string) => {
                let clean = sentence;
                // Remove any DSML/function_call tags and their content
                clean = clean.replace(/<\s*\|?\s*(?:DSML|function_calls?|antml|invoke|parameter)[^>]*>[\s\S]*?(?:<\s*\/[^>]*>|$)/gi, "");
                // Also catch pipe-separated DSML format: < | DSML | ...
                clean = clean.replace(/<\s*\|\s*DSML[\s\S]*/gi, "");
                // Remove counter tags
                clean = clean.replace(/\[COUNTER:\w+\]/gi, "");
                clean = clean.trim();
                console.log("[TTS] Sentence detected:", clean.slice(0, 50), "length:", clean.length);
                if (clean.length < 1) return;
                const blobPromise = ttsProvider === "local"
                    ? prefetchLocalTTS(clean, localTtsVoice)
                    : ttsProvider === "piper"
                        ? prefetchPiperTTS(clean)
                        : prefetchEdgeTTS(clean, edgeTtsVoice);
                queue.push({ text: clean, blobPromise });
            });
            console.log("[TTS] Stream finished, raw response length:", rawResponse.length);

            queue.finish();
            isProcessingRef.current = false; // allow new queries immediately
            await playerPromise; // TTS finishes playing in background

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
            activeQueueRef.current = null;
            isProcessingRef.current = false;
            // Always unmute mic after voice cycle ends (speaking or error)
            const cli = clientRef.current;
            if (cli && "unmuteMic" in cli) {
                (cli as { unmuteMic: () => void }).unmuteMic();
            }
            if (clientRef.current) setOrbState("listening");
        }
    }, [userId, addMessage, updateLastAssistantMessage, setOrbState, sendToChat, playBlob, startBargeInDetector]);

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

        // ── iOS Audio Unlock — MUST be FIRST, before any await ──
        // iOS user gesture context expires after the first microtask boundary (await).
        // We create the <audio> element and call play() synchronously here,
        // while the gesture is still active. This "unlocks" the element
        // for all future programmatic play() calls.
        const audioEl = document.createElement("audio");
        audioEl.setAttribute("playsinline", "true");
        audioEl.style.display = "none";
        document.body.appendChild(audioEl);
        edgeTtsAudioElRef.current = audioEl;

        const SILENT_MP3 = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRwMHAAAAAAD/+1DEAAAFAAn/AAAAIAAAP8AAAASRhGKYGBkYGBAADAxAwMDEDAgICAgICAgYGBgYGBgYGBv//8QAAAAAM";
        audioEl.src = SILENT_MP3;
        audioEl.volume = 0;
        audioEl.play().then(() => {
            console.log("[TTS] iOS audio unlock: silent play succeeded");
            audioEl.pause();
            audioEl.removeAttribute("src");
            audioEl.volume = 1.0;
        }).catch(() => {
            console.warn("[TTS] iOS audio unlock: silent play failed");
            audioEl.removeAttribute("src");
            audioEl.volume = 1.0;
        });

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

        // Warmup TTS — прогреть нужный провайдер в зависимости от настроек
        const { ttsProvider, edgeTtsVoice, localTtsVoice } =
            useSettingsStore.getState();

        if (ttsProvider === "local") {
            fetch("/api/tts-local", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: "прогрев", voice: localTtsVoice ?? "kseniya" }),
            }).catch(() => {});
        } else if (ttsProvider === "piper") {
            fetch("/api/tts-piper", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: "прогрев" }),
            }).catch(() => {});
        } else {
            fetch("/api/tts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: " ", voice: edgeTtsVoice }),
            }).catch(() => {});
        }

        console.log("[TTS] Audio element ready (direct playback, iOS unlocked)");

        let interimText = "";

        const callbacks: LocalVoiceCallbacks = {
            onTranscriptUser: (text: string, isFinal: boolean) => {
                // If still speaking (barge-in in progress) — show transcript but don't start cycle
                if (isSpeakingRef.current) {
                    if (!isFinal) setLiveTranscript(text);
                    return;
                }
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
                // If assistant is speaking — barge-in: stop TTS immediately
                if (isSpeakingRef.current) {
                    console.log("[Voice] Barge-in: user started speaking, interrupting TTS");
                    abortRef.current?.abort();
                    cleanupTTS();
                    isSpeakingRef.current = false;
                    isProcessingRef.current = false;
                    if (activeQueueRef.current) {
                        activeQueueRef.current.finish();
                        activeQueueRef.current = null;
                    }
                    // Unmute STT so user's speech gets through
                    const cli = clientRef.current;
                    if (cli && "unmuteMic" in cli) {
                        (cli as { unmuteMic: () => void }).unmuteMic();
                    }
                    setOrbState("listening");
                    return;
                }
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
                    const ctx = new AudioContext();
                    if (ctx.state === "suspended") {
                        await ctx.resume();
                    }
                    micAudioCtxRef.current = ctx;
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
                    // TTS audio level is set directly in playBlob via ontimeupdate
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
        if (bargeInRafRef.current) {
            cancelAnimationFrame(bargeInRafRef.current);
            bargeInRafRef.current = null;
        }
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

        if (micAudioCtxRef.current) {
            micAudioCtxRef.current.close().catch(() => { /* silent */ });
            micAudioCtxRef.current = null;
        }

        isProcessingRef.current = false;
        setIsVoiceActive(false);
        setOrbState("idle");
        setModality("text");
    }, [setOrbState, setModality, setAudioLevel, setLiveTranscript, cleanupTTS, stopRecognition, abortChat]);

    // ── Interrupt speaking (tap-to-interrupt) ──
    const interruptSpeaking = useCallback(() => {
        if (!isSpeakingRef.current) return;
        console.log("[Voice] User tapped Orb — interrupting TTS");
        abortRef.current?.abort();
        cleanupTTS();
        isSpeakingRef.current = false;
        isProcessingRef.current = false;
        if (activeQueueRef.current) {
            activeQueueRef.current.finish();
            activeQueueRef.current = null;
        }
        // Unmute STT so user can speak
        const cli = clientRef.current;
        if (cli && "unmuteMic" in cli) {
            (cli as { unmuteMic: () => void }).unmuteMic();
        }
        setOrbState("listening");
    }, [cleanupTTS, setOrbState, abortRef]);

    return { isVoiceActive, startVoice, stopVoice, interruptSpeaking } as const;
}
