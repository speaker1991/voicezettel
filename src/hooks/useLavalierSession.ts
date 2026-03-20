"use client";

import { useRef, useCallback, useState } from "react";
import {
    LocalVoiceClient,
    type LocalVoiceCallbacks,
} from "@/lib/localVoiceClient";
import { useLavalierStore } from "@/stores/lavalierStore";
import { useChatStore } from "@/stores/chatStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUser } from "@/components/providers/UserProvider";
import { logger } from "@/lib/logger";
import { useChatStream } from "@/hooks/useChatStream";
import {
    prefetchEdgeTTS,
    prefetchLocalTTS,
    prefetchPiperTTS,
    cleanResponseText,
    AsyncQueue,
    type SentenceJob,
} from "@/hooks/voiceHelpers";

/**
 * useLavalierSession — hook for background meeting recording.
 * Uses LocalVoiceClient (local GPU STT via WebSocket) for transcription.
 * When stopped, sends the transcript to the meeting-summary API,
 * then saves the result to Obsidian.
 *
 * Also supports asking the assistant questions mid-meeting via askAssistant().
 */
export function useLavalierSession() {
    const clientRef = useRef<LocalVoiceClient | null>(null);
    const [isActive, setIsActive] = useState(false);

    const setOrbState = useChatStore((s) => s.setOrbState);
    const setAudioLevel = useChatStore((s) => s.setAudioLevel);
    const addTranscriptEntry = useLavalierStore(
        (s) => s.addTranscriptEntry,
    );
    const startMeeting = useLavalierStore((s) => s.startMeeting);
    const stopMeetingStore = useLavalierStore((s) => s.stopMeeting);

    const { userId } = useUser();
    const { sendToChat } = useChatStream();
    const addMessage = useChatStore((s) => s.addMessage);
    const updateLastAssistantMessage = useChatStore(
        (s) => s.updateLastAssistantMessage,
    );
    const edgeTtsAudioElRef = useRef<HTMLAudioElement | null>(null);
    const isAskingRef = useRef(false);
    const lastTranscriptRef = useRef("");

    const stopLavalier = useCallback(() => {
        // Clean up TTS audio element
        if (edgeTtsAudioElRef.current) {
            edgeTtsAudioElRef.current.pause();
            edgeTtsAudioElRef.current.remove();
            edgeTtsAudioElRef.current = null;
        }
        isAskingRef.current = false;

        if (clientRef.current) {
            clientRef.current.stop();
            clientRef.current = null;
        }
        setIsActive(false);
        stopMeetingStore();
        setOrbState("idle");
        setAudioLevel(0);
    }, [setOrbState, setAudioLevel, stopMeetingStore]);

    const askAssistant = useCallback(
        async (userText: string) => {
            if (isAskingRef.current || !userText.trim()) return;
            isAskingRef.current = true;

            // Mute Whisper — don't write assistant's voice into meeting transcript
            clientRef.current?.muteMic();
            setOrbState("thinking");

            // Create audio element on first call (iOS requires user gesture)
            if (!edgeTtsAudioElRef.current) {
                const audioEl = document.createElement("audio");
                audioEl.setAttribute("playsinline", "true");
                audioEl.style.display = "none";
                document.body.appendChild(audioEl);
                edgeTtsAudioElRef.current = audioEl;
            }

            const { ttsProvider, edgeTtsVoice, localTtsVoice } = useSettingsStore.getState();
            const queue = new AsyncQueue<SentenceJob>();

            addMessage({
                id: crypto.randomUUID(),
                role: "user",
                content: userText,
                timestamp: new Date().toISOString(),
                source: "voice",
            });
            addMessage({
                id: crypto.randomUUID(),
                role: "assistant",
                content: "",
                timestamp: new Date().toISOString(),
                source: "voice",
            });

            setOrbState("speaking");

            try {
                const rawResponse = await sendToChat(
                    userText,
                    (sentence: string) => {
                        const clean = sentence
                            .replace(/\[COUNTER:\w+\]/gi, "")
                            .replace(/[*_#>`~]/g, "")
                            .trim();
                        if (clean.length > 2) {
                            const blobPromise = ttsProvider === "local"
                                ? prefetchLocalTTS(clean, localTtsVoice)
                                : ttsProvider === "piper"
                                    ? prefetchPiperTTS(clean)
                                    : prefetchEdgeTTS(clean, edgeTtsVoice);
                            queue.push({ text: clean, blobPromise });
                        }
                    },
                    "voice",
                );

                queue.finish();

                // Play sentence queue
                for await (const job of queue) {
                    const blob = await job.blobPromise;
                    if (blob && blob.size > 0 && edgeTtsAudioElRef.current) {
                        await new Promise<void>((resolve) => {
                            const audioEl = edgeTtsAudioElRef.current!;
                            const url = URL.createObjectURL(blob);
                            audioEl.src = url;
                            const wd = setTimeout(resolve, 20000);
                            const done = () => {
                                clearTimeout(wd);
                                URL.revokeObjectURL(url);
                                resolve();
                            };
                            audioEl.onended = done;
                            audioEl.onerror = done;
                            audioEl.play().catch(done);
                        });
                    }
                }

                updateLastAssistantMessage({
                    content: cleanResponseText(rawResponse),
                });
            } catch (err) {
                if ((err as Error).name !== "AbortError") {
                    logger.error(
                        "[Lavalier] askAssistant error:",
                        (err as Error).message,
                    );
                }
            } finally {
                // Resume meeting recording
                clientRef.current?.unmuteMic();
                setOrbState("backgroundListening");
                isAskingRef.current = false;
            }
        },
        [sendToChat, addMessage, updateLastAssistantMessage, setOrbState, userId],
    );

    const startLavalier = useCallback(async () => {
        if (clientRef.current) return;

        // Check if local core is available
        const available = await LocalVoiceClient.isAvailable();
        if (!available) {
            useNotificationStore
                .getState()
                .addNotification(
                    "Local Core не запущен. Запустите local_core/start.ps1",
                    "error",
                );
            return;
        }

        setOrbState("backgroundListening");
        startMeeting();

        const callbacks: LocalVoiceCallbacks = {
            onTranscriptUser: (text: string, isFinal: boolean) => {
                if (!isFinal || text.trim().length === 0) return;

                const t = text.trim();
                lastTranscriptRef.current = t;

                // Detect question to assistant
                const isQuestion =
                    /[?？]$/.test(t) ||
                    /^(эй|зеттель|ассистент|слушай|помоги|скажи|что такое|как называется|напомни|запомни|какой|сколько)/i.test(t);

                if (isQuestion && !isAskingRef.current) {
                    logger.info(`[Lavalier] Question to assistant: ${t.slice(0, 60)}`);
                    void askAssistant(t);
                } else {
                    addTranscriptEntry(t);
                    logger.info(`[Lavalier] Transcript: ${t.slice(0, 80)}`);
                }
            },

            onUserSpeechStarted: () => {
                // Orb stays in backgroundListening, just pulse
            },

            onUserSpeechStopped: () => {
                // Keep backgroundListening state
            },

            onStatusChange: (status) => {
                if (status === "ready") {
                    logger.info("[Lavalier] STT ready");
                    useNotificationStore
                        .getState()
                        .addNotification("Петличка подключена", "info");
                } else if (status === "error") {
                    logger.error("[Lavalier] Connection error");
                    stopLavalier();
                }
            },

            onError: (message: string) => {
                logger.error("[Lavalier] Error:", message);
                useNotificationStore
                    .getState()
                    .addNotification(`Петличка: ${message}`, "error");
                stopLavalier();
            },
        };

        const client = new LocalVoiceClient(callbacks);
        clientRef.current = client;

        try {
            await client.start();
            setIsActive(true);
            logger.info("[Lavalier] Started — recording meeting");
        } catch (err) {
            logger.error(
                "Failed to start lavalier:",
                err instanceof Error ? err.message : err,
            );
            useNotificationStore
                .getState()
                .addNotification(
                    `Не удалось запустить петличку: ${err instanceof Error ? err.message : "Ошибка"}`,
                    "error",
                );
            clientRef.current = null;
            setOrbState("idle");
            stopMeetingStore();
        }
    }, [
        addTranscriptEntry,
        setOrbState,
        setAudioLevel,
        startMeeting,
        stopMeetingStore,
        stopLavalier,
        askAssistant,
    ]);

    const pauseLavalier = useCallback(() => {
        clientRef.current?.muteMic();
        useLavalierStore.getState().pauseMeeting();
    }, []);

    const resumeLavalier = useCallback(() => {
        clientRef.current?.unmuteMic();
        useLavalierStore.getState().resumeMeeting();
    }, []);

    return {
        isActive,
        startLavalier,
        stopLavalier,
        pauseLavalier,
        resumeLavalier,
        askAssistant,
        lastTranscriptRef,
    } as const;
}
