"use client";

import { useRef, useCallback } from "react";
import { useSettingsStore } from "@/stores/settingsStore";

/**
 * Hook for ElevenLabs text-to-speech.
 * Sends text to /api/tts proxy, plays the returned audio stream.
 * Supports optional onEnded callback for orb state synchronization.
 */
export function useElevenLabsTTS() {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const urlRef = useRef<string | null>(null);

    const speak = useCallback(async (text: string, onEnded?: () => void) => {
        // Strip COUNTER tags before speaking
        const clean = text
            .replace(/\[COUNTER:[a-z]+\]/gi, "")
            .replace(/⚠️/g, "")
            .trim();
        if (!clean || clean.length < 2) {
            onEnded?.();
            return;
        }

        try {
            // Stop previous playback
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
            if (urlRef.current) {
                URL.revokeObjectURL(urlRef.current);
                urlRef.current = null;
            }

            const voiceId = useSettingsStore.getState().elevenLabsVoiceId;

            const res = await fetch("/api/tts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: clean, voiceId }),
            });

            if (!res.ok) {
                onEnded?.();
                return;
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            urlRef.current = url;

            const audio = new Audio(url);
            audioRef.current = audio;

            audio.onended = () => {
                if (urlRef.current) {
                    URL.revokeObjectURL(urlRef.current);
                    urlRef.current = null;
                }
                audioRef.current = null;
                onEnded?.();
            };

            await audio.play().catch(() => {
                /* autoplay blocked — silent fail */
                onEnded?.();
            });
        } catch {
            onEnded?.();
        }
    }, []);

    const stop = useCallback(() => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
        }
        if (urlRef.current) {
            URL.revokeObjectURL(urlRef.current);
            urlRef.current = null;
        }
    }, []);

    return { speak, stop };
}
