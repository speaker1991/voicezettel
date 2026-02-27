"use client";

import { useRef, useCallback, useState } from "react";
import {
    RealtimeVoiceClient,
    type VoiceClientCallbacks,
} from "@/lib/realtimeVoiceClient";
import { useLavalierStore } from "@/stores/lavalierStore";
import { useChatStore } from "@/stores/chatStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { logger } from "@/lib/logger";

export function useLavalierSession() {
    const clientRef = useRef<RealtimeVoiceClient | null>(null);
    const [isActive, setIsActive] = useState(false);

    const setOrbState = useChatStore((s) => s.setOrbState);
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
    }, [setOrbState, stopMeetingStore]);

    const startLavalier = useCallback(async () => {
        if (clientRef.current) return;

        setOrbState("backgroundListening");
        startMeeting();

        const callbacks: VoiceClientCallbacks = {
            onConnected: () => {
                setOrbState("backgroundListening");
            },

            onTranscriptUser: (text: string) => {
                addTranscriptEntry(text);
            },

            onTranscriptAssistant: () => {
                // In lavalier mode we don't display AI responses
            },

            onAudioStart: () => {
                // No-op in lavalier mode
            },

            onAudioEnd: () => {
                // No-op in lavalier mode
            },

            onUserSpeechStarted: () => {
                // Keep backgroundListening state
            },

            onUserSpeechStopped: () => {
                // Keep backgroundListening state
            },

            onSessionError: (err: Error) => {
                logger.error("Lavalier session error:", err.message);
                useNotificationStore
                    .getState()
                    .addNotification(err.message, "error");
                stopLavalier();
            },
        };

        const client = new RealtimeVoiceClient(callbacks);
        clientRef.current = client;

        try {
            await client.start();
            setIsActive(true);
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
