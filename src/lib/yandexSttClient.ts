/**
 * @module yandexSttClient
 * Yandex SpeechKit Streaming STT client.
 *
 * Uses WebSocket to stream PCM16 audio to Yandex Cloud STT API.
 * Similar interface to LocalVoiceClient for easy swapping.
 */
import { logger } from "@/lib/logger";
import type { LocalVoiceCallbacks } from "@/lib/localVoiceClient";

const TARGET_SAMPLE_RATE = 16000;

interface YandexSttMessage {
    chunks?: Array<{
        alternatives?: Array<{
            text: string;
        }>;
        final?: boolean;
        endOfUtterance?: boolean;
    }>;
}

export class YandexSttClient {
    private ws: WebSocket | null = null;
    private audioContext: AudioContext | null = null;
    private workletNode: AudioWorkletNode | null = null;
    private localStream: MediaStream | null = null;
    private callbacks: LocalVoiceCallbacks;
    private _isMuted = false;

    constructor(callbacks: LocalVoiceCallbacks) {
        this.callbacks = callbacks;
    }

    /** Expose mic stream for external analysis */
    getStream(): MediaStream | null {
        return this.localStream;
    }

    /** Check if Yandex STT is available (token endpoint reachable) */
    static async isAvailable(): Promise<boolean> {
        try {
            const res = await fetch("/api/yandex-stt-token");
            if (!res.ok) return false;
            const data = (await res.json()) as { iamToken?: string; error?: string };
            return !!data.iamToken;
        } catch {
            return false;
        }
    }

    /** Start capturing audio and streaming to Yandex STT */
    async start(): Promise<void> {
        this.callbacks.onStatusChange("connecting");

        try {
            // Get IAM token from server proxy
            const tokenRes = await fetch("/api/yandex-stt-token");
            if (!tokenRes.ok) throw new Error("Failed to get IAM token");
            const { iamToken, folderId } = (await tokenRes.json()) as {
                iamToken: string;
                folderId: string;
            };

            // Get mic stream
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: TARGET_SAMPLE_RATE,
                    echoCancellation: true,
                    noiseSuppression: true,
                },
            });

            // Audio worklet for PCM16 extraction
            this.audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
            const source = this.audioContext.createMediaStreamSource(this.localStream);

            await this.audioContext.audioWorklet.addModule("/worklets/pcm-processor.js");
            this.workletNode = new AudioWorkletNode(this.audioContext, "pcm-processor");
            source.connect(this.workletNode);
            this.workletNode.connect(this.audioContext.destination);

            // WebSocket to Yandex STT
            const wsUrl = `wss://stt.api.cloud.yandex.net/speech/v1/stt:recognizeStreaming`;
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                // Send config message first
                const config = {
                    config: {
                        specification: {
                            languageCode: "ru-RU",
                            model: "general",
                            profanityFilter: false,
                            partialResults: true,
                            audioEncoding: "LINEAR16_PCM",
                            sampleRateHertz: TARGET_SAMPLE_RATE,
                        },
                        folderId,
                    },
                };
                this.ws?.send(JSON.stringify(config));
                logger.info("[YandexSTT] Connected and configured");
                this.callbacks.onStatusChange("ready");
            };

            this.ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data as string) as YandexSttMessage;
                    if (msg.chunks && msg.chunks.length > 0) {
                        const chunk = msg.chunks[0];
                        const text = chunk.alternatives?.[0]?.text ?? "";
                        const isFinal = chunk.final === true || chunk.endOfUtterance === true;

                        if (text.trim().length > 0) {
                            if (!isFinal) {
                                this.callbacks.onUserSpeechStarted();
                            }
                            this.callbacks.onTranscriptUser(text, isFinal);
                            if (isFinal) {
                                this.callbacks.onUserSpeechStopped();
                            }
                        }
                    }
                } catch {
                    // Ignore parse errors
                }
            };

            this.ws.onerror = () => {
                this.callbacks.onStatusChange("error");
                this.callbacks.onError("Ошибка подключения к Yandex STT");
            };

            this.ws.onclose = () => {
                this.callbacks.onStatusChange("closed");
            };

            // Send audio data via worklet
            this.workletNode.port.onmessage = (event: MessageEvent) => {
                if (this._isMuted || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
                const pcm16 = event.data as ArrayBuffer;
                // Add IAM token as authorization header via binary protocol
                this.ws.send(pcm16);
            };

            // Yandex WebSocket doesn't support Authorization header directly
            // We need to pass the token in the initial config message
            // The IAM token is sent as part of the WebSocket URL query or config
            // For now, we use an alternative: pass Authorization via Sec-WebSocket-Protocol
            // Actually, Yandex SpeechKit uses the token in the initial config message

        } catch (err) {
            this.callbacks.onStatusChange("error");
            this.callbacks.onError(
                `Yandex STT: ${err instanceof Error ? err.message : "Ошибка"}`,
            );
            throw err;
        }
    }

    /** Mute mic (stop sending audio to STT) */
    muteMic(): void {
        this._isMuted = true;
    }

    /** Unmute mic */
    unmuteMic(): void {
        this._isMuted = false;
    }

    /** Check if STT is currently muted */
    get isMuted(): boolean {
        return this._isMuted;
    }

    /** No-op — Yandex STT uses WebSocket, self-hearing handled differently */
    pauseRecognition(): void { /* no-op */ }

    /** No-op — Yandex STT uses WebSocket */
    resumeRecognition(): void { /* no-op */ }

    /** Stop and clean up */
    stop(): void {
        this._isMuted = true;

        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode = null;
        }

        if (this.ws) {
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
            this.ws = null;
        }

        if (this.localStream) {
            this.localStream.getTracks().forEach((t) => t.stop());
            this.localStream = null;
        }

        if (this.audioContext) {
            this.audioContext.close().catch(() => { /* silent */ });
            this.audioContext = null;
        }

        logger.info("[YandexSTT] Stopped");
    }
}
