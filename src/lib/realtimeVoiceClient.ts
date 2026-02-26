import type {
    RealtimeClientEvent,
    RealtimeServerEvent,
    EphemeralTokenResponse,
} from "@/types/voice";
import { EphemeralTokenResponseSchema } from "@/types/voice";
import { logger } from "@/lib/logger";

// ── Callback types ───────────────────────────────────────────
export interface VoiceClientCallbacks {
    onTranscriptUser: (text: string) => void;
    onTranscriptAssistant: (text: string) => void;
    onAudioStart: () => void;
    onAudioEnd: () => void;
    onSessionError: (err: Error) => void;
    onConnected: () => void;
}

// ── OpenAI Realtime WebRTC endpoint ──────────────────────────
const REALTIME_BASE_URL = "https://api.openai.com/v1/realtime";
const REALTIME_MODEL = "gpt-4o-realtime-preview-2024-12-17";

// ── Client class ─────────────────────────────────────────────
export class RealtimeVoiceClient {
    private pc: RTCPeerConnection | null = null;
    private dc: RTCDataChannel | null = null;
    private localStream: MediaStream | null = null;
    private audioEl: HTMLAudioElement | null = null;
    private assistantTranscript = "";
    private callbacks: VoiceClientCallbacks;

    constructor(callbacks: VoiceClientCallbacks) {
        this.callbacks = callbacks;
    }

    // ── Public API ───────────────────────────────────────────

    async start(): Promise<void> {
        // 1. Fetch ephemeral token from our server route
        const token = await this.fetchEphemeralToken();

        // 2. Create peer connection
        this.pc = new RTCPeerConnection();

        // 3. Set up remote audio playback
        this.audioEl = document.createElement("audio");
        this.audioEl.autoplay = true;

        this.pc.ontrack = (event) => {
            if (this.audioEl && event.streams[0]) {
                this.audioEl.srcObject = event.streams[0];
            }
        };

        // 4. Capture microphone
        this.localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
        });
        for (const track of this.localStream.getTracks()) {
            this.pc.addTrack(track, this.localStream);
        }

        // 5. Open data channel for events
        this.dc = this.pc.createDataChannel("oai-events");
        this.dc.onopen = () => {
            this.configureSession();
            this.callbacks.onConnected();
        };
        this.dc.onmessage = (event: MessageEvent) => {
            this.handleServerEvent(event);
        };

        // 6. SDP offer/answer exchange
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);

        const sdpResponse = await fetch(
            `${REALTIME_BASE_URL}?model=${REALTIME_MODEL}`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/sdp",
                },
                body: offer.sdp,
            },
        );

        if (!sdpResponse.ok) {
            throw new Error(
                `SDP exchange failed: ${sdpResponse.status} ${await sdpResponse.text()}`,
            );
        }

        const answerSdp = await sdpResponse.text();
        await this.pc.setRemoteDescription({
            type: "answer",
            sdp: answerSdp,
        });
    }

    stop(): void {
        if (this.dc) {
            this.dc.close();
            this.dc = null;
        }
        if (this.localStream) {
            for (const track of this.localStream.getTracks()) {
                track.stop();
            }
            this.localStream = null;
        }
        if (this.pc) {
            this.pc.close();
            this.pc = null;
        }
        if (this.audioEl) {
            this.audioEl.srcObject = null;
            this.audioEl = null;
        }
        this.assistantTranscript = "";
    }

    sendText(text: string): void {
        if (!this.dc || this.dc.readyState !== "open") {
            this.callbacks.onSessionError(
                new Error("Data channel is not open"),
            );
            return;
        }

        const createEvent: RealtimeClientEvent = {
            type: "conversation.item.create",
            item: {
                type: "message",
                role: "user",
                content: [{ type: "input_text", text }],
            },
        };
        this.dc.send(JSON.stringify(createEvent));

        const responseEvent: RealtimeClientEvent = {
            type: "response.create",
        };
        this.dc.send(JSON.stringify(responseEvent));
    }

    // ── Private helpers ──────────────────────────────────────

    private async fetchEphemeralToken(): Promise<string> {
        const res = await fetch("/api/realtime-token", { method: "POST" });

        if (!res.ok) {
            const body = await res.json().catch(() => ({ error: "Unknown" }));
            const errMsg =
                typeof body === "object" &&
                    body !== null &&
                    "error" in body &&
                    typeof (body as Record<string, unknown>).error === "string"
                    ? (body as { error: string }).error
                    : "Failed to get ephemeral token";
            throw new Error(errMsg);
        }

        const data: unknown = await res.json();
        const parsed = EphemeralTokenResponseSchema.safeParse(data);
        if (!parsed.success) {
            throw new Error("Invalid ephemeral token response shape");
        }
        return parsed.data.client_secret.value;
    }

    private configureSession(): void {
        if (!this.dc || this.dc.readyState !== "open") return;

        const sessionUpdate: RealtimeClientEvent = {
            type: "session.update",
            session: {
                input_audio_transcription: {
                    model: "whisper-1",
                },
            },
        };
        this.dc.send(JSON.stringify(sessionUpdate));
    }

    private handleServerEvent(event: MessageEvent): void {
        let parsed: RealtimeServerEvent;
        try {
            parsed = JSON.parse(String(event.data)) as RealtimeServerEvent;
        } catch {
            logger.warn("Failed to parse Realtime server event");
            return;
        }

        switch (parsed.type) {
            case "conversation.item.input_audio_transcription.completed":
                this.callbacks.onTranscriptUser(parsed.transcript);
                break;

            case "response.audio_transcript.delta":
                if (this.assistantTranscript === "") {
                    this.callbacks.onAudioStart();
                }
                this.assistantTranscript += parsed.delta;
                this.callbacks.onTranscriptAssistant(
                    this.assistantTranscript,
                );
                break;

            case "response.audio_transcript.done":
                this.assistantTranscript = "";
                break;

            case "response.audio.done":
                this.callbacks.onAudioEnd();
                break;

            case "error":
                this.callbacks.onSessionError(
                    new Error(parsed.error.message),
                );
                break;

            default:
                logger.debug("Unhandled Realtime event:", parsed.type);
                break;
        }
    }
}
