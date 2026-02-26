"use client";

import { useRef, useCallback, useState } from "react";
import {
    RealtimeVoiceClient,
    type VoiceClientCallbacks,
} from "@/lib/realtimeVoiceClient";
import { useChatStore } from "@/stores/chatStore";
import { logger } from "@/lib/logger";

export function useVoiceSession() {
    const clientRef = useRef<RealtimeVoiceClient | null>(null);
    const [isVoiceActive, setIsVoiceActive] = useState(false);

    const addMessage = useChatStore((s) => s.addMessage);
    const updateLastAssistantMessage = useChatStore(
        (s) => s.updateLastAssistantMessage,
    );
    const setOrbState = useChatStore((s) => s.setOrbState);
    const setModality = useChatStore((s) => s.setModality);

    // Track whether we already pushed the assistant placeholder
    const hasAssistantPlaceholder = useRef(false);

    const startVoice = useCallback(async () => {
        if (clientRef.current) return;

        setModality("voice");
        setOrbState("thinking"); // connecting…

        const callbacks: VoiceClientCallbacks = {
            onConnected: () => {
                setOrbState("listening");
            },

            onTranscriptUser: (text: string) => {
                addMessage({
                    id: crypto.randomUUID(),
                    role: "user",
                    content: text,
                    timestamp: new Date().toISOString(),
                    source: "voice",
                });
            },

            onTranscriptAssistant: (accumulated: string) => {
                if (!hasAssistantPlaceholder.current) {
                    hasAssistantPlaceholder.current = true;
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
                hasAssistantPlaceholder.current = false;
                setOrbState("speaking");
            },

            onAudioEnd: () => {
                hasAssistantPlaceholder.current = false;
                setOrbState("listening");
            },

            onSessionError: (err: Error) => {
                logger.error("Voice session error:", err.message);
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
                err instanceof Error ? err.message : err,
            );
            clientRef.current = null;
            setOrbState("idle");
            setModality("text");
        }
    }, [addMessage, updateLastAssistantMessage, setOrbState, setModality]);

    const stopVoiceInternal = useCallback(() => {
        if (clientRef.current) {
            clientRef.current.stop();
            clientRef.current = null;
        }
        hasAssistantPlaceholder.current = false;
        setIsVoiceActive(false);
        setOrbState("idle");
        setModality("text");
    }, [setOrbState, setModality]);

    const stopVoice = useCallback(() => {
        stopVoiceInternal();
    }, [stopVoiceInternal]);

    return {
        isVoiceActive,
        startVoice,
        stopVoice,
    } as const;
}
