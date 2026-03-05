"use client";

import { useRef, useCallback } from "react";
import { useSettingsStore } from "@/stores/settingsStore";

/**
 * Hook for Edge TTS (Microsoft neural voices).
 * Sends text to /api/tts proxy, plays the returned audio.
 * Supports optional onEnded callback and external audio element for mobile autoplay.
 */
export function useEdgeTTS() {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const urlRef = useRef<string | null>(null);

    /**
     * @param text - Text to speak
     * @param onEnded - Optional callback when playback finishes
     * @param externalAudioEl - Optional audio element to reuse (for mobile autoplay)
     */
    const speak = useCallback(async (
        text: string,
        onEnded?: () => void,
        externalAudioEl?: HTMLAudioElement | null,
    ) => {
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
            if (audioRef.current && !externalAudioEl) {
                audioRef.current.pause();
                audioRef.current = null;
            }
            if (urlRef.current) {
                URL.revokeObjectURL(urlRef.current);
                urlRef.current = null;
            }

            const voice = useSettingsStore.getState().edgeTtsVoice;

            const res = await fetch("/api/tts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: clean, voice }),
            });

            if (!res.ok) {
                onEnded?.();
                return;
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            urlRef.current = url;

            // Use external audio element if provided (avoids iOS autoplay block)
            const audio = externalAudioEl ?? new Audio();
            audio.src = url;
            audioRef.current = audio;

            audio.onended = () => {
                if (urlRef.current) {
                    URL.revokeObjectURL(urlRef.current);
                    urlRef.current = null;
                }
                if (!externalAudioEl) {
                    audioRef.current = null;
                }
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
            audioRef.current.src = "";
            audioRef.current = null;
        }
        if (urlRef.current) {
            URL.revokeObjectURL(urlRef.current);
            urlRef.current = null;
        }
    }, []);

    return { speak, stop };
}
