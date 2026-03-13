"use client";

import { useRef, useCallback, useState, useEffect } from "react";
import {
    LocalVoiceClient,
    type LocalVoiceCallbacks,
} from "@/lib/localVoiceClient";
import { useChatStore } from "@/stores/chatStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useAnimationStore } from "@/stores/animationStore";
import { useCountersStore } from "@/stores/countersStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { detectCounterTypes, stripCounterTag } from "@/lib/detectCounterType";
import { extractPreferences, stripPrefTag } from "@/lib/detectPreference";
import { sendToObsidian } from "@/lib/obsidianClient";
import { useUser } from "@/components/providers/UserProvider";
import { logger } from "@/lib/logger";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { stripDSML } from "@/lib/stripDSML";

/* ─── Types for sentence queue ─── */
interface SentenceJob {
    text: string;
    blobPromise: Promise<Blob | null>;
}

/**
 * Pre-fetch EdgeTTS audio for a sentence.
 * Returns a Blob or null on failure. Does NOT play anything.
 */
async function prefetchEdgeTTS(text: string, voice: string): Promise<Blob | null> {
    try {
        // Strip emoji, counter tags, and markdown before TTS
        const clean = text
            .replace(/\[COUNTER:\w+\]/gi, "")
            .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1FFFF}]/gu, "")
            .replace(/[*_#>`~]/g, "")
            .replace(/\s{2,}/g, " ")
            .trim();
        if (!clean || clean.length < 2) return null;
        const res = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: clean, voice }),
        });
        if (!res.ok) return null;
        return await res.blob();
    } catch {
        return null;
    }
}

/**
 * useVoiceSession — Local STT (faster-whisper GPU) + any LLM + sentence-streaming EdgeTTS.
 *
 * Flow: Mic → WebSocket → faster-whisper → /api/chat (stream) → EdgeTTS per sentence
 * GPT streams text; as soon as the first sentence ends (. ! ?) its audio is fetched.
 * While sentence N plays, sentence N+1 is already being fetched in the background.
 */
export function useVoiceSession() {
    const clientRef = useRef<LocalVoiceClient | null>(null);
    const [isVoiceActive, setIsVoiceActive] = useState(false);
    const { userId } = useUser();

    const addMessage = useChatStore((s) => s.addMessage);
    const updateLastAssistantMessage = useChatStore(
        (s) => s.updateLastAssistantMessage,
    );
    const setOrbState = useChatStore((s) => s.setOrbState);
    const setModality = useChatStore((s) => s.setModality);
    const setAudioLevel = useChatStore((s) => s.setAudioLevel);
    const setLiveTranscript = useChatStore((s) => s.setLiveTranscript);

    // Refs
    const isProcessingRef = useRef(false);
    const abortRef = useRef<AbortController | null>(null);
    const edgeTtsAudioElRef = useRef<HTMLAudioElement | null>(null);
    const ttsAudioCtxRef = useRef<AudioContext | null>(null);
    const ttsAnalyserRef = useRef<AnalyserNode | null>(null);
    const ttsAnalyserDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
    const audioLevelRafRef = useRef<number | null>(null);
    const micAnalyserRef = useRef<AnalyserNode | null>(null);
    const micAnalyserDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
    const browserTtsWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const browserTtsKeepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const { start: startRecognition, stop: stopRecognition } = useSpeechRecognition();

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

    // ── Stream GPT with sentence detection ──
    const sendToChat = useCallback(async (
        userText: string,
        onSentence: (sentence: string) => void,
    ): Promise<string> => {
        const { aiProvider, systemPrompt } = useSettingsStore.getState();
        const allMessages = useChatStore.getState().messages;
        const history = allMessages.slice(-20).map((m) => ({
            role: m.role,
            content: m.content,
        }));

        abortRef.current = new AbortController();

        const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                messages: history,
                provider: aiProvider,
                systemPrompt,
                userId,
                source: "voice",
            }),
            signal: abortRef.current.signal,
        });

        if (!res.ok) {
            const errBody = await res.json().catch(() => ({
                error: "Unknown error",
            }));
            throw new Error(
                (errBody as { error?: string }).error ?? `HTTP ${res.status}`,
            );
        }
        if (!res.body) throw new Error("No response body");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";
        let sentenceBuffer = "";
        let streamModel = "";
        let streamPromptTokens = 0;
        let streamCompletionTokens = 0;

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
                        model?: string;
                        usage?: {
                            prompt_tokens?: number;
                            completion_tokens?: number;
                        };
                    };

                    if (parsed.model && !streamModel) {
                        streamModel = parsed.model;
                    }
                    if (parsed.usage) {
                        streamPromptTokens = parsed.usage.prompt_tokens ?? 0;
                        streamCompletionTokens = parsed.usage.completion_tokens ?? 0;
                    }

                    const content = parsed.choices?.[0]?.delta?.content;
                    if (content) {
                        accumulated += content;
                        sentenceBuffer += content;
                        // Strip DSML in real-time so chat bubble never shows tags
                        updateLastAssistantMessage({ content: stripDSML(accumulated) });

                        // Detect sentence boundaries: .!?… followed by space or newline
                        const sentenceEnd = /[.!?…]+[\s\n]+/;
                        let match = sentenceEnd.exec(sentenceBuffer);
                        while (match) {
                            const idx = match.index + match[0].length;
                            const sentence = sentenceBuffer.slice(0, idx).trim();
                            if (sentence.length > 5) {
                                onSentence(sentence);
                            }
                            sentenceBuffer = sentenceBuffer.slice(idx);
                            match = sentenceEnd.exec(sentenceBuffer);
                        }
                    }
                } catch {
                    // skip
                }
            }
        }

        // Flush remaining text as final sentence
        const remaining = sentenceBuffer.trim();
        if (remaining.length > 2) {
            onSentence(remaining);
        }

        // Report token usage
        if (streamPromptTokens > 0 || streamCompletionTokens > 0) {
            const reportModel = streamModel || "gpt-4o-mini";
            useCountersStore.getState().reportTokenUsage(
                userId ?? "",
                reportModel,
                streamPromptTokens,
                streamCompletionTokens,
            ).catch(() => { /* silent */ });
        }

        abortRef.current = null;
        return accumulated;
    }, [userId, updateLastAssistantMessage]);

    // ── Clean response text ──
    const cleanResponse = useCallback((raw: string): string => {
        let text = stripDSML(raw);
        const counterTypes = detectCounterTypes(text);
        if (counterTypes.length > 0) text = stripCounterTag(text);
        text = stripPrefTag(text);
        text = text.replace(/^\{["']?\s*/, "").replace(/\s*["']?\}$/, "");
        text = text.replace(/^["']+|["']+$/g, "");
        text = text.replace(/\\n/g, "\n").trim();
        return text;
    }, []);

    // ── Play a single audio blob on the shared audio element ──
    const playBlob = useCallback((blob: Blob): Promise<void> => {
        return new Promise<void>((resolve) => {
            const audioEl = edgeTtsAudioElRef.current;
            if (!audioEl) {
                resolve();
                return;
            }
            const url = URL.createObjectURL(blob);
            audioEl.src = url;

            const done = () => {
                URL.revokeObjectURL(url);
                resolve();
            };

            audioEl.onended = done;
            audioEl.onerror = done;

            // Watchdog — max 20s per sentence
            const wd = setTimeout(() => {
                audioEl.pause();
                done();
            }, 20000);

            audioEl.play().then(() => {
                // Clear watchdog on natural end
                audioEl.onended = () => {
                    clearTimeout(wd);
                    done();
                };
            }).catch(() => {
                clearTimeout(wd);
                done();
            });
        });
    }, []);

    // ── Process one voice cycle with sentence-streaming TTS ──
    const processVoiceCycle = useCallback(async (userText: string) => {
        if (isProcessingRef.current) return;
        isProcessingRef.current = true;

        // Sentence queue: text + pre-fetched audio blob
        const queue: SentenceJob[] = [];
        let streamDone = false;
        let playerRunning = false;

        // Sequential player — plays blobs one after another
        const runPlayer = async () => {
            if (playerRunning) return;
            playerRunning = true;
            setOrbState("speaking");

            while (queue.length > 0 || !streamDone) {
                if (queue.length === 0) {
                    // Wait 50ms for more sentences
                    await new Promise((r) => setTimeout(r, 50));
                    continue;
                }
                const job = queue.shift()!;
                const blob = await job.blobPromise;
                if (blob && blob.size > 0) {
                    await playBlob(blob);
                }
            }
            playerRunning = false;
        };

        const voice = useSettingsStore.getState().edgeTtsVoice;

        try {
            // 1. Add user message
            addMessage({
                id: crypto.randomUUID(),
                role: "user",
                content: userText,
                timestamp: new Date().toISOString(),
                source: "voice",
            });

            // 2. Thinking
            setOrbState("thinking");
            clientRef.current?.muteMic();

            // 3. Create assistant placeholder
            addMessage({
                id: crypto.randomUUID(),
                role: "assistant",
                content: "",
                timestamp: new Date().toISOString(),
                source: "voice",
            });

            // 4. Stream GPT + pre-fetch TTS per sentence
            const playerPromise = (async () => {
                // Wait for first sentence before starting player
                while (queue.length === 0 && !streamDone) {
                    await new Promise((r) => setTimeout(r, 30));
                }
                await runPlayer();
            })();

            const rawResponse = await sendToChat(userText, (sentence: string) => {
                // Clean DSML from sentence
                let clean = sentence;
                clean = clean.replace(/<\s*\|?\s*(?:DSML|function_calls?|antml|invoke|parameter)[^>]*>[\s\S]*?(?:<\s*\/[^>]*>|$)/gi, "");
                clean = clean.trim();
                if (clean.length < 3) return;

                // Pre-fetch audio blob immediately (don't wait)
                const blobPromise = prefetchEdgeTTS(clean, voice);
                queue.push({ text: clean, blobPromise });
            });

            streamDone = true;

            // Wait for player to finish all queued sentences
            await playerPromise;

            // 5. Clean & finalize response text
            const cleanText = cleanResponse(rawResponse);
            updateLastAssistantMessage({ content: cleanText });

            // 6. Counters & preferences
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

            // 7. Auto-save to Obsidian
            sendToObsidian(userText, cleanText, userId).catch(() => { /* silent */ });

            // 8. Save to voice memory
            fetch("/api/voice-memory", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId,
                    userText,
                    assistantText: cleanText,
                }),
            }).catch(() => { /* silent */ });

        } catch (err) {
            if ((err as Error).name !== "AbortError") {
                logger.error("Voice cycle error:", (err as Error).message);
                useNotificationStore
                    .getState()
                    .addNotification(
                        `Ошибка: ${(err as Error).message}`,
                        "error",
                    );
            }
        } finally {
            streamDone = true;
            isProcessingRef.current = false;
            clientRef.current?.unmuteMic();
            if (clientRef.current) {
                setOrbState("listening");
            }
        }
    }, [
        userId,
        addMessage,
        updateLastAssistantMessage,
        setOrbState,
        sendToChat,
        cleanResponse,
        playBlob,
    ]);

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
            useNotificationStore
                .getState()
                .addNotification(
                    "Local Core не запущен. Запустите local_core: python main.py",
                    "error",
                );
            return;
        }

        setModality("voice");
        setOrbState("listening");

        // Create audio element for TTS playback (user gesture context)
        const audioEl = document.createElement("audio");
        audioEl.setAttribute("playsinline", "true");
        audioEl.style.display = "none";
        document.body.appendChild(audioEl);
        edgeTtsAudioElRef.current = audioEl;

        // Set up TTS audio analyser for orb visualization
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
        } catch {
            // Non-critical
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
                if (!isProcessingRef.current) {
                    setOrbState("listening");
                }
            },

            onUserSpeechStopped: () => {
                if (!isProcessingRef.current && interimText.trim()) {
                    setOrbState("thinking");
                }
            },

            onStatusChange: (status) => {
                if (status === "ready") {
                    logger.info("[Voice] Local STT connected");
                } else if (status === "error") {
                    logger.error("[Voice] STT connection error");
                    useNotificationStore
                        .getState()
                        .addNotification("Ошибка подключения к STT", "error");
                }
            },

            onError: (message: string) => {
                logger.error("[Voice] Error:", message);
                useNotificationStore
                    .getState()
                    .addNotification(`Голос: ${message}`, "error");
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

            // Set up mic analyser for orb visualization (particles react to voice)
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
                } catch {
                    // Non-critical
                }
            }

            // Audio level metering
            const getTtsLevel = (): number => {
                if (!ttsAnalyserRef.current || !ttsAnalyserDataRef.current) return 0;
                ttsAnalyserRef.current.getByteFrequencyData(ttsAnalyserDataRef.current);
                let sum = 0;
                for (let i = 0; i < ttsAnalyserDataRef.current.length; i++) {
                    sum += ttsAnalyserDataRef.current[i];
                }
                return Math.min(sum / (ttsAnalyserDataRef.current.length * 128), 1);
            };

            // Mic audio level getter
            const getMicLevel = (): number => {
                if (!micAnalyserRef.current || !micAnalyserDataRef.current) return 0;
                micAnalyserRef.current.getByteFrequencyData(micAnalyserDataRef.current);
                let sum = 0;
                for (let i = 0; i < micAnalyserDataRef.current.length; i++) {
                    sum += micAnalyserDataRef.current[i];
                }
                return Math.min(sum / (micAnalyserDataRef.current.length * 128), 1);
            };

            const meterLoop = () => {
                const orbSt = useChatStore.getState().orbState;
                if (orbSt === "speaking") {
                    setAudioLevel(getTtsLevel());
                } else if (orbSt === "listening") {
                    setAudioLevel(getMicLevel());
                } else {
                    setAudioLevel(0.05);
                }
                audioLevelRafRef.current = requestAnimationFrame(meterLoop);
            };
            audioLevelRafRef.current = requestAnimationFrame(meterLoop);

            logger.info("[Voice] Session started (Local STT + LLM + EdgeTTS sentence streaming)");
        } catch (err) {
            logger.error("Failed to start voice:", err instanceof Error ? err.message : err);
            useNotificationStore
                .getState()
                .addNotification(
                    `Не удалось запустить голос: ${err instanceof Error ? err.message : "Ошибка"}`,
                    "error",
                );
            clientRef.current = null;
            setOrbState("idle");
            setModality("text");
        }
    }, [
        setOrbState,
        setModality,
        setAudioLevel,
        setLiveTranscript,
        processVoiceCycle,
        cleanupTTS,
        startRecognition,
    ]);

    // ── Stop voice session ──
    const stopVoice = useCallback(() => {
        if (clientRef.current) {
            clientRef.current.stop();
            clientRef.current = null;
        }
        abortRef.current?.abort();
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
    }, [setOrbState, setModality, setAudioLevel, setLiveTranscript, cleanupTTS, stopRecognition]);

    return {
        isVoiceActive,
        startVoice,
        stopVoice,
    } as const;
}
