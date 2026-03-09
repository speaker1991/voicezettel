"use client";

import { useRef, useCallback } from "react";
import { useChatStore } from "@/stores/chatStore";
import { logger } from "@/lib/logger";

/**
 * Web Speech API wrapper for real-time transcription display.
 * Runs in parallel with OpenAI Realtime API — only for UI, not for AI conversation.
 * Shows interim results in chatStore.liveTranscript.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type SpeechRecognitionInstance = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export function useSpeechRecognition() {
    const recognitionRef = useRef<SpeechRecognitionInstance>(null);
    const isRunningRef = useRef(false);

    const start = useCallback(() => {
        if (isRunningRef.current) return;

        const w = window as unknown as Record<string, unknown>;
        const SpeechRecognitionClass = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
            | (new () => SpeechRecognitionInstance)
            | undefined;

        if (!SpeechRecognitionClass) {
            logger.warn("SpeechRecognition not supported in this browser");
            return;
        }

        const recognition = new SpeechRecognitionClass();
        recognition.lang = "ru-RU";
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onresult = (event: { results: { length: number;[i: number]: { isFinal: boolean; 0: { transcript: string } } }; resultIndex: number }) => {
            let interim = "";
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                if (!result.isFinal) {
                    interim += result[0].transcript;
                }
            }
            useChatStore.getState().setLiveTranscript(interim);
        };

        recognition.onerror = (event: { error: string }) => {
            if (event.error !== "no-speech" && event.error !== "aborted") {
                logger.warn("SpeechRecognition error:", event.error);
            }
        };

        recognition.onend = () => {
            // Do NOT auto-restart — on Android it causes system beep sounds.
            // Recognition runs once per voice session with continuous: true.
            isRunningRef.current = false;
            useChatStore.getState().setLiveTranscript("");
        };

        try {
            recognition.start();
            recognitionRef.current = recognition;
            isRunningRef.current = true;
        } catch {
            logger.warn("Failed to start SpeechRecognition");
        }
    }, []);

    const stop = useCallback(() => {
        isRunningRef.current = false;
        if (recognitionRef.current) {
            try {
                recognitionRef.current.stop();
            } catch {
                // Already stopped
            }
            recognitionRef.current = null;
        }
        useChatStore.getState().setLiveTranscript("");
    }, []);

    return { start, stop };
}
