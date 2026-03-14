/**
 * BrowserSttClient — Web Speech API STT client.
 * Same interface as LocalVoiceClient / YandexSttClient for seamless swapping.
 * Works without GPU server — uses browser-native SpeechRecognition.
 */

import { logger } from "@/lib/logger";
import type { LocalVoiceCallbacks } from "@/lib/localVoiceClient";

/* eslint-disable @typescript-eslint/no-explicit-any */
type SpeechRecognitionInstance = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class BrowserSttClient {
    private recognition: SpeechRecognitionInstance | null = null;
    private localStream: MediaStream | null = null;
    private callbacks: LocalVoiceCallbacks;
    private _isMuted = false;
    private _running = false;

    constructor(callbacks: LocalVoiceCallbacks) {
        this.callbacks = callbacks;
    }

    /** Expose mic stream for audio level visualization */
    getStream(): MediaStream | null {
        return this.localStream;
    }

    /** Check if Web Speech API is available in this browser */
    static isAvailable(): boolean {
        if (typeof window === "undefined") return false;
        const w = window as unknown as Record<string, unknown>;
        return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition);
    }

    /** Start capturing audio and recognizing speech */
    async start(): Promise<void> {
        this.callbacks.onStatusChange("connecting");

        const w = window as unknown as Record<string, unknown>;
        const SpeechRecognitionClass = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
            | (new () => SpeechRecognitionInstance)
            | undefined;

        if (!SpeechRecognitionClass) {
            this.callbacks.onError("SpeechRecognition not supported");
            this.callbacks.onStatusChange("error");
            throw new Error("SpeechRecognition not supported in this browser");
        }

        // Get mic stream (for audio level metering only — SpeechRecognition uses its own)
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Mic access denied";
            this.callbacks.onError(msg);
            this.callbacks.onStatusChange("error");
            throw err;
        }

        const recognition = new SpeechRecognitionClass();
        recognition.lang = "ru-RU";
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onresult = (event: {
            results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } };
            resultIndex: number;
        }) => {
            if (this._isMuted) return;

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                const text = result[0].transcript;

                if (result.isFinal) {
                    this.callbacks.onTranscriptUser(text, true);
                    this.callbacks.onUserSpeechStopped();
                } else {
                    this.callbacks.onTranscriptUser(text, false);
                }
            }
        };

        recognition.onspeechstart = () => {
            if (!this._isMuted) {
                this.callbacks.onUserSpeechStarted();
            }
        };

        recognition.onerror = (event: { error: string }) => {
            if (event.error === "no-speech" || event.error === "aborted") return;
            logger.warn("[BrowserSTT] Error:", event.error);
            this.callbacks.onError(`Браузерный STT: ${event.error}`);
        };

        recognition.onend = () => {
            // Auto-restart if session is still active (browser stops after ~60s silence)
            if (this._running && !this._isMuted) {
                try {
                    recognition.start();
                } catch {
                    logger.warn("[BrowserSTT] Failed to restart");
                }
            }
        };

        try {
            recognition.start();
            this.recognition = recognition;
            this._running = true;
            this.callbacks.onStatusChange("ready");
            logger.info("[BrowserSTT] Started");
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Failed to start";
            this.callbacks.onError(msg);
            this.callbacks.onStatusChange("error");
            throw err;
        }
    }

    /** Mute — stop processing speech results */
    muteMic(): void {
        this._isMuted = true;
    }

    /** Unmute — resume processing speech results */
    unmuteMic(): void {
        this._isMuted = false;
    }

    /** Stop and clean up */
    stop(): void {
        this._running = false;
        this._isMuted = true;

        if (this.recognition) {
            try {
                this.recognition.stop();
            } catch {
                // Already stopped
            }
            this.recognition = null;
        }

        if (this.localStream) {
            for (const track of this.localStream.getTracks()) {
                track.stop();
            }
            this.localStream = null;
        }

        logger.info("[BrowserSTT] Stopped");
    }
}
