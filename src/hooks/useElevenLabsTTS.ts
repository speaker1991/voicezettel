"use client";

import { useRef, useCallback } from "react";
import { useSettingsStore } from "@/stores/settingsStore";

/**
 * Hook for Edge TTS (Microsoft neural voices).
 * Sends text to /api/tts proxy, streams audio via MediaSource API.
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

            if (!res.ok || !res.body) {
                onEnded?.();
                return;
            }

            // ── MediaSource streaming: play audio as chunks arrive ──
            if (typeof MediaSource !== "undefined" && MediaSource.isTypeSupported("audio/mpeg")) {
                const mediaSource = new MediaSource();
                const url = URL.createObjectURL(mediaSource);
                urlRef.current = url;

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

                mediaSource.addEventListener("sourceopen", async () => {
                    const sb = mediaSource.addSourceBuffer("audio/mpeg");
                    const reader = res.body!.getReader();

                    const pump = async (): Promise<void> => {
                        const { done, value } = await reader.read();
                        if (done) {
                            if (mediaSource.readyState === "open") {
                                mediaSource.endOfStream();
                            }
                            return;
                        }
                        // Wait for buffer to finish updating before appending
                        if (sb.updating) {
                            await new Promise<void>((r) =>
                                sb.addEventListener("updateend", () => r(), { once: true }),
                            );
                        }
                        sb.appendBuffer(value);
                        sb.addEventListener("updateend", () => void pump(), { once: true });
                    };

                    void pump();
                }, { once: true });

                await audio.play().catch(() => {
                    onEnded?.();
                });
            } else {
                // ── Fallback: blob buffering (for browsers without MediaSource) ──
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                urlRef.current = url;

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
                    onEnded?.();
                });
            }
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
