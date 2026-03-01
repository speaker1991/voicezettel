import type {
    RealtimeClientEvent,
    RealtimeServerEvent,
} from "@/types/voice";
import { EphemeralTokenResponseSchema } from "@/types/voice";
import { CHANGELOG } from "@/lib/changelog";
import { logger } from "@/lib/logger";

// ── Callback types ───────────────────────────────────────────
export interface VoiceClientCallbacks {
    onTranscriptUser: (text: string) => void;
    onTranscriptAssistant: (text: string) => void;
    onAudioStart: () => void;
    onAudioEnd: () => void;
    onSessionError: (err: Error) => void;
    onConnected: () => void;
    onUserSpeechStarted: () => void;
    onUserSpeechStopped: () => void;
}

// ── Client class ─────────────────────────────────────────────
export class RealtimeVoiceClient {
    private pc: RTCPeerConnection | null = null;
    private dc: RTCDataChannel | null = null;
    private localStream: MediaStream | null = null;
    private audioEl: HTMLAudioElement | null = null;
    private assistantTranscript = "";
    private ephemeralToken = "";
    private callbacks: VoiceClientCallbacks;
    private contextStr = "";

    constructor(callbacks: VoiceClientCallbacks) {
        this.callbacks = callbacks;
    }

    // ── Public API ───────────────────────────────────────────

    async start(context?: string): Promise<void> {
        // Save context for session config
        this.contextStr = context ?? "";

        // 1. Fetch ephemeral token from our server route
        this.ephemeralToken = await this.fetchEphemeralToken();

        // 2. Create peer connection with STUN for NAT traversal
        this.pc = new RTCPeerConnection({
            iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
            ],
        });

        // DEBUG: monitor connection states
        this.pc.oniceconnectionstatechange = () => {
            logger.warn("ICE state:", this.pc?.iceConnectionState);
        };
        this.pc.onconnectionstatechange = () => {
            logger.warn("Connection state:", this.pc?.connectionState);
        };

        // 3. Set up remote audio playback
        this.audioEl = document.createElement("audio");
        this.audioEl.autoplay = true;
        this.audioEl.setAttribute("playsinline", "true");
        // Attach to DOM for better mobile audio handling
        this.audioEl.style.display = "none";
        document.body.appendChild(this.audioEl);

        this.pc.ontrack = (event) => {
            logger.warn("Remote track received:", event.track.kind);
            if (this.audioEl && event.streams[0]) {
                this.audioEl.srcObject = event.streams[0];
                // Ensure playback starts (needed on mobile)
                this.audioEl.play().catch(() => {
                    logger.warn("Auto-play blocked, user interaction needed");
                });
            }
        };

        // 4. Capture microphone
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error(
                "Микрофон недоступен. Убедитесь что страница открыта через HTTPS.",
            );
        }
        this.localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
        });
        for (const track of this.localStream.getTracks()) {
            this.pc.addTrack(track, this.localStream);
            logger.warn("Added audio track:", track.label, "enabled:", track.enabled, "muted:", track.muted);
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

        // 6. SDP offer/answer exchange (through server proxy to avoid CORS)
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);

        const sdpResponse = await fetch("/api/realtime-sdp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sdp: offer.sdp,
                token: this.ephemeralToken,
            }),
        });

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
            this.audioEl.remove();
            this.audioEl = null;
        }
        this.assistantTranscript = "";
    }

    /** Mute local mic (while AI speaks to prevent echo) */
    muteMic(): void {
        if (this.localStream) {
            for (const track of this.localStream.getAudioTracks()) {
                track.enabled = false;
            }
        }
    }

    /** Unmute local mic */
    unmuteMic(): void {
        if (this.localStream) {
            for (const track of this.localStream.getAudioTracks()) {
                track.enabled = true;
            }
        }
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

        const changelogContext = CHANGELOG.slice(0, 5)
            .map((e) => `- ${e.message}`)
            .join("\n");

        const sessionUpdate: RealtimeClientEvent = {
            type: "session.update",
            session: {
                modalities: ["text", "audio"],
                instructions: `Ты — Экзокортекс, голосовой ИИ-помощник VoiceZettel. Отвечай ТОЛЬКО на русском. Будь максимально краток — 1-3 предложения. Не повторяй вопрос пользователя.

Твои принципы:
- Радар ценности: Вылавливай инсайты и неочевидные выводы.
- Если пользователь делится мыслью — запомни и предложи развить.
- Если пользователь просит создать/записать/запомнить что-то, добавь тег:
  - Задачи, заметки → [COUNTER:tasks]
  - Идеи, мысли → [COUNTER:ideas]
  - Факты, знания → [COUNTER:facts]
  - Люди, контакты → [COUNTER:persons]

Пример: "Записал! [COUNTER:tasks]"
Не добавляй тег если пользователь просто разговаривает.

Последние обновления:
${changelogContext}

${this.contextStr}`,
                input_audio_transcription: {
                    model: "whisper-1",
                    language: "ru",
                },
                turn_detection: {
                    type: "server_vad",
                    threshold: 0.7,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 1200,
                },
            },
        };
        this.dc.send(JSON.stringify(sessionUpdate));
        logger.warn("Session configured with VAD");
    }

    private handleServerEvent(event: MessageEvent): void {
        let parsed: RealtimeServerEvent;
        try {
            parsed = JSON.parse(String(event.data)) as RealtimeServerEvent;
        } catch {
            logger.warn("Failed to parse Realtime server event");
            return;
        }

        // DEBUG: log all incoming events
        logger.warn("Realtime event:", parsed.type, parsed);

        switch (parsed.type) {
            case "input_audio_buffer.speech_started":
                this.callbacks.onUserSpeechStarted();
                break;

            case "input_audio_buffer.speech_stopped":
                this.callbacks.onUserSpeechStopped();
                break;

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
