/**
 * LocalVoiceClient — WebSocket client for local STT (faster-whisper on GPU).
 * Captures mic audio via AudioWorklet, sends PCM16 to local FastAPI server,
 * receives transcription and VAD events.
 */

import { logger } from "@/lib/logger";

export interface LocalVoiceCallbacks {
    onTranscriptUser: (text: string, isFinal: boolean) => void;
    onUserSpeechStarted: () => void;
    onUserSpeechStopped: () => void;
    onStatusChange: (status: "connecting" | "ready" | "error" | "closed") => void;
    onError: (message: string) => void;
}

interface STTMessage {
    type: "transcript" | "vad" | "status" | "error";
    text?: string;
    is_final?: boolean;
    event?: "speech_started" | "speech_stopped";
    message?: string;
}

function getWsUrl(): string {
    if (typeof window === "undefined") return "ws://localhost:8000/ws/voice";
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws/voice`;
}

const TARGET_SAMPLE_RATE = 16000;

export class LocalVoiceClient {
    private ws: WebSocket | null = null;
    private audioContext: AudioContext | null = null;
    private workletNode: AudioWorkletNode | null = null;
    private localStream: MediaStream | null = null;
    private callbacks: LocalVoiceCallbacks;
    private _isMuted = false;

    constructor(callbacks: LocalVoiceCallbacks) {
        this.callbacks = callbacks;
    }

    /** Expose mic stream for external analysis (e.g. orb visualization) */
    getStream(): MediaStream | null {
        return this.localStream;
    }

    /**
     * Start capturing audio and streaming to local STT.
     */
    async start(): Promise<void> {
        this.callbacks.onStatusChange("connecting");

        try {
            // 1. Get mic stream at target sample rate
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: TARGET_SAMPLE_RATE,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });

            // 2. Set up AudioContext + Worklet
            this.audioContext = new AudioContext({
                sampleRate: TARGET_SAMPLE_RATE,
            });

            await this.audioContext.audioWorklet.addModule(
                "/worklets/pcm16-processor.js",
            );

            const source = this.audioContext.createMediaStreamSource(
                this.localStream,
            );

            this.workletNode = new AudioWorkletNode(
                this.audioContext,
                "pcm16-processor",
            );

            // 3. Connect WebSocket
            this.ws = new WebSocket(getWsUrl());
            this.ws.binaryType = "arraybuffer";

            this.ws.onopen = () => {
                logger.info("[LocalVoice] WebSocket connected");
            };

            this.ws.onmessage = (event: MessageEvent) => {
                this.handleMessage(event);
            };

            this.ws.onerror = (event: Event) => {
                logger.error("[LocalVoice] WebSocket error:", event);
                this.callbacks.onError("WebSocket connection failed");
                this.callbacks.onStatusChange("error");
            };

            this.ws.onclose = () => {
                logger.info("[LocalVoice] WebSocket closed");
                this.callbacks.onStatusChange("closed");
            };

            // 4. Route audio worklet output to WebSocket
            this.workletNode.port.onmessage = (
                event: MessageEvent<ArrayBuffer>,
            ) => {
                if (
                    this._isMuted ||
                    !this.ws ||
                    this.ws.readyState !== WebSocket.OPEN
                ) {
                    return;
                }
                // Send raw PCM16 bytes
                this.ws.send(event.data);
            };

            // 5. Connect audio pipeline
            source.connect(this.workletNode);
            // Don't connect to destination (we don't want to hear ourselves)
            // workletNode.connect(this.audioContext.destination);

            logger.info("[LocalVoice] Audio pipeline ready");
        } catch (error) {
            const msg =
                error instanceof Error ? error.message : "Unknown error";
            logger.error("[LocalVoice] Start failed:", msg);
            this.callbacks.onError(msg);
            this.callbacks.onStatusChange("error");
            throw error;
        }
    }

    /**
     * Handle incoming WebSocket messages from the STT server.
     */
    private handleMessage(event: MessageEvent): void {
        if (typeof event.data !== "string") return;

        try {
            const msg = JSON.parse(event.data) as STTMessage;

            switch (msg.type) {
                case "transcript":
                    if (msg.text) {
                        this.callbacks.onTranscriptUser(
                            msg.text,
                            msg.is_final ?? false,
                        );
                    }
                    break;

                case "vad":
                    if (msg.event === "speech_started") {
                        this.callbacks.onUserSpeechStarted();
                    } else if (msg.event === "speech_stopped") {
                        this.callbacks.onUserSpeechStopped();
                    }
                    break;

                case "status":
                    if (msg.message === "ready") {
                        this.callbacks.onStatusChange("ready");
                        logger.info("[LocalVoice] STT ready");
                    }
                    break;

                case "error":
                    logger.error("[LocalVoice] STT error:", msg.message);
                    this.callbacks.onError(msg.message ?? "STT error");
                    break;
            }
        } catch (e) {
            logger.warn("[LocalVoice] Failed to parse message:", e);
        }
    }

    /**
     * Mute the microphone (stop sending audio).
     */
    muteMic(): void {
        this._isMuted = true;
        this.workletNode?.port.postMessage("stop");
    }

    /**
     * Unmute the microphone (resume sending audio).
     */
    unmuteMic(): void {
        this._isMuted = false;
        this.workletNode?.port.postMessage("start");
    }

    /**
     * Stop everything and clean up.
     */
    stop(): void {
        // Close WebSocket
        if (this.ws) {
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
            this.ws = null;
        }

        // Disconnect audio worklet
        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode = null;
        }

        // Close audio context
        if (this.audioContext) {
            this.audioContext.close().catch(() => {
                /* silent */
            });
            this.audioContext = null;
        }

        // Stop media stream
        if (this.localStream) {
            for (const track of this.localStream.getTracks()) {
                track.stop();
            }
            this.localStream = null;
        }

        this._isMuted = false;
        logger.info("[LocalVoice] Stopped");
    }

    /**
     * Check if the local core is available.
     */
    static async isAvailable(): Promise<boolean> {
        try {
            const url = "/api/local-health";
            const res = await fetch(url, {
                signal: AbortSignal.timeout(2000),
            });
            return res.ok;
        } catch {
            return false;
        }
    }
}
