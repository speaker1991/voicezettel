"use client";

import { useRef, useCallback, useState } from "react";
import {
    RealtimeVoiceClient,
    type VoiceClientCallbacks,
} from "@/lib/realtimeVoiceClient";
import { useChatStore } from "@/stores/chatStore";
import { useAnimationStore } from "@/stores/animationStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { detectCounterType, stripCounterTag } from "@/lib/detectCounterType";
import { logger } from "@/lib/logger";

export function useVoiceSession() {
    const clientRef = useRef<RealtimeVoiceClient | null>(null);
    const [isVoiceActive, setIsVoiceActive] = useState(false);

    const addMessage = useChatStore((s) => s.addMessage);
    const updateLastAssistantMessage = useChatStore(
        (s) => s.updateLastAssistantMessage
    );
    const insertMessageBeforeLastAssistant = useChatStore(
        (s) => s.insertMessageBeforeLastAssistant
    );
    const setOrbState = useChatStore((s) => s.setOrbState);
    const setModality = useChatStore((s) => s.setModality);

    // Track the current AI response cycle
    const isAssistantResponding = useRef(false);
    // Track if user transcript for current turn already arrived
    const userTranscriptReceived = useRef(false);
    // Track accumulated AI response text for counter detection
    const lastAssistantText = useRef("");

    const stopVoiceInternal = useCallback(() => {
        if (clientRef.current) {
            clientRef.current.stop();
            clientRef.current = null;
        }
        isAssistantResponding.current = false;
        userTranscriptReceived.current = false;
        setIsVoiceActive(false);
        setOrbState("idle");
        setModality("text");
    }, [setOrbState, setModality]);

    const startVoice = useCallback(async () => {
        if (clientRef.current) return;

        setModality("voice");
        setOrbState("listening"); // Show listening while connecting

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
                if (!isAssistantResponding.current) {
                    isAssistantResponding.current = true;
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
            },

            onAudioStart: () => {
                // Mute mic while AI speaks to prevent echo
                clientRef.current?.muteMic();
                setOrbState("speaking");
            },

            onUserSpeechStarted: () => {
                setOrbState("listening");
            },

            onUserSpeechStopped: () => {
                setOrbState("thinking");
            },

            onAudioEnd: () => {
                // Unmute mic for next user turn
                clientRef.current?.unmuteMic();

                // Detect counter type from AI response
                const counterType = detectCounterType(
                    lastAssistantText.current,
                );
                if (counterType) {
                    useAnimationStore
                        .getState()
                        .triggerAnimation(counterType);
                    // Strip tag from displayed message
                    const cleaned = stripCounterTag(
                        lastAssistantText.current,
                    );
                    updateLastAssistantMessage({ content: cleaned });
                }

                isAssistantResponding.current = false;
                userTranscriptReceived.current = false;
                lastAssistantText.current = "";
                setOrbState("listening");
            },

            onSessionError: (err: Error) => {
                logger.error("Voice session error:", err.message);
                useNotificationStore
                    .getState()
                    .addNotification(err.message, "error");
                stopVoiceInternal();
            },
        };

        const client = new RealtimeVoiceClient(callbacks);
        clientRef.current = client;

        try {
            await client.start();
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
        addMessage,
        updateLastAssistantMessage,
        insertMessageBeforeLastAssistant,
        setOrbState,
        setModality,
        stopVoiceInternal,
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
