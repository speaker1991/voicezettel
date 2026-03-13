"use client";

import { useRef, useCallback, useState } from "react";
import {
    LocalVoiceClient,
    type LocalVoiceCallbacks,
} from "@/lib/localVoiceClient";
import { useLavalierStore } from "@/stores/lavalierStore";
import { useChatStore } from "@/stores/chatStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { logger } from "@/lib/logger";

/**
 * useLavalierSession — hook for background meeting recording.
 * Uses LocalVoiceClient (local GPU STT via WebSocket) for transcription.
 * When stopped, sends the transcript to the meeting-summary API,
 * then saves the result to Obsidian.
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

    const stopLavalier = useCallback(() => {
        if (clientRef.current) {
            clientRef.current.stop();
            clientRef.current = null;
        }
        setIsActive(false);
        stopMeetingStore();
        setOrbState("idle");
        setAudioLevel(0);
    }, [setOrbState, setAudioLevel, stopMeetingStore]);

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
                if (isFinal && text.trim().length > 0) {
                    addTranscriptEntry(text.trim());
                    logger.info(`[Lavalier] Transcript: ${text.trim().slice(0, 80)}`);
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
    } as const;
}
