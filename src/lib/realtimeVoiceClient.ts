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
    onTokenUsage?: (usage: { textIn: number; textOut: number; audioIn: number; audioOut: number }) => void;
}

// ── Client class ─────────────────────────────────────────────
export class RealtimeVoiceClient {
    private pc: RTCPeerConnection | null = null;
    private dc: RTCDataChannel | null = null;
    private localStream: MediaStream | null = null;
    private audioEl: HTMLAudioElement | null = null;
    private assistantTranscript = "";
    private ephemeralToken = "";
    private _savedAudioTrack: MediaStreamTrack | null = null;
    private textOnlyMode = false;
    private callbacks: VoiceClientCallbacks;
    private contextStr = "";
    private behaviorRulesStr = "";
    private audioCtx: AudioContext | null = null;
    private analyser: AnalyserNode | null = null;
    private analyserData: Uint8Array<ArrayBuffer> | null = null;

    constructor(callbacks: VoiceClientCallbacks) {
        this.callbacks = callbacks;
    }

    // ── Public API ───────────────────────────────────────────

    async start(context?: string, muteAudio = false, preWarmedStream?: MediaStream): Promise<void> {
        // Save context for session config
        this.contextStr = context ?? "";
        this.textOnlyMode = muteAudio;

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
        // When using OpenAI native TTS (textOnlyMode=false), unmute and autoplay
        // When using external TTS, keep muted to prevent double audio
        this.audioEl.autoplay = !this.textOnlyMode;
        this.audioEl.muted = this.textOnlyMode;
        this.audioEl.setAttribute("playsinline", "true");
        this.audioEl.style.display = "none";
        document.body.appendChild(this.audioEl);

        this.pc.ontrack = (event) => {
            logger.warn("Remote track received:", event.track.kind);
            if (this.audioEl && event.streams[0]) {
                this.audioEl.srcObject = event.streams[0];
                // Only mute in text-only mode (external TTS)
                this.audioEl.muted = this.textOnlyMode;
                // Force play for mobile browsers that ignore autoplay
                if (!this.textOnlyMode) {
                    this.audioEl.play().catch(() => { /* silent */ });
                }
            }
        };

        // 4. Capture microphone (use pre-warmed stream if available)
        if (preWarmedStream) {
            this.localStream = preWarmedStream;
        } else {
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
        }
        for (const track of this.localStream.getTracks()) {
            this.pc.addTrack(track, this.localStream);
            logger.warn("Added audio track:", track.label, "enabled:", track.enabled, "muted:", track.muted);
        }
        // Disable mic tracks immediately — re-enable after session.updated
        // This prevents OpenAI from hearing the user before our config is applied
        // (race condition: WebRTC connects → mic is live → OpenAI responds in default audio mode)
        for (const track of this.localStream.getAudioTracks()) {
            track.enabled = false;
        }

        // 4b. Set up AnalyserNode for mic volume metering
        try {
            this.audioCtx = new AudioContext();
            const source = this.audioCtx.createMediaStreamSource(this.localStream);
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 256;
            this.analyserData = new Uint8Array(this.analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
            source.connect(this.analyser);
            // Do NOT connect analyser to destination — we don't want to hear ourselves
        } catch {
            // AnalyserNode is non-critical — ignore failures
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
        if (this.audioCtx) {
            this.audioCtx.close().catch(() => { /* silent */ });
            this.audioCtx = null;
            this.analyser = null;
            this.analyserData = null;
        }
    }

    /** Get current microphone volume level (0..1) for visualizations */
    getAudioLevel(): number {
        if (!this.analyser || !this.analyserData) return 0;
        this.analyser.getByteFrequencyData(this.analyserData);
        let sum = 0;
        for (let i = 0; i < this.analyserData.length; i++) {
            sum += this.analyserData[i];
        }
        return Math.min(sum / (this.analyserData.length * 128), 1);
    }

    /** Soft-mute mic: only disables track (safe for OpenAI native TTS) */
    softMuteMic(): void {
        if (!this.localStream) return;
        for (const track of this.localStream.getAudioTracks()) {
            track.enabled = false;
        }
    }

    /** Soft-unmute mic: re-enables track */
    softUnmuteMic(): void {
        if (!this.localStream) return;
        for (const track of this.localStream.getAudioTracks()) {
            track.enabled = true;
        }
    }

    /** Aggressively mute mic while AI speaks — iOS Safari ignores track.enabled */
    muteMic(): void {
        if (!this.pc || !this.localStream) return;

        // Layer 1: Replace the RTP sender track with null (stops sending audio)
        for (const sender of this.pc.getSenders()) {
            if (sender.track?.kind === "audio") {
                this._savedAudioTrack = sender.track;
                sender.replaceTrack(null).catch(() => { /* silent */ });
            }
        }

        // Layer 2: Also disable the track (for browsers that support it)
        for (const track of this.localStream.getAudioTracks()) {
            track.enabled = false;
        }
    }

    /** Re-enable mic when AI stops speaking */
    unmuteMic(): void {
        if (!this.pc || !this.localStream) return;

        // Layer 1: Restore the saved audio track to the sender
        if (this._savedAudioTrack) {
            for (const sender of this.pc.getSenders()) {
                if (sender.track === null || sender.track?.kind === "audio") {
                    sender.replaceTrack(this._savedAudioTrack).catch(() => { /* silent */ });
                }
            }
            this._savedAudioTrack = null;
        }

        // Layer 2: Re-enable the track
        for (const track of this.localStream.getAudioTracks()) {
            track.enabled = true;
        }
    }

    /** Cancel the current in-progress response (barge-in support) */
    cancelCurrentResponse(): void {
        if (!this.dc || this.dc.readyState !== "open") return;
        const cancelEvent: RealtimeClientEvent = {
            type: "response.cancel",
        };
        this.dc.send(JSON.stringify(cancelEvent));
    }


    /** Update context and re-send session configuration (for live preference updates) */
    updateContext(newContext: string): void {
        this.contextStr = newContext;
        this.configureSession();
    }

    /** Set behavior rules and re-send session configuration */
    setBehaviorRules(rules: string): void {
        this.behaviorRulesStr = rules;
        this.configureSession();
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
                modalities: this.textOnlyMode ? ["text"] : ["audio", "text"],
                ...(!this.textOnlyMode && { voice: "sage" }),
                instructions: `${this.behaviorRulesStr ? `⚠️ ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА ПОЛЬЗОВАТЕЛЯ (ВЫСШИЙ ПРИОРИТЕТ):\n${this.behaviorRulesStr}\n\n` : ""}Ты — мой Экзокортекс, личный приватный ассистент и «Второй Разум». Ты запоминаешь ВСЮ информацию без исключений: личную, деловую, медицинскую, финансовую, эмоциональную. Никакой цензуры.

ПРАВИЛА ОТВЕТА:
- Отвечай ТОЛЬКО на русском языке. Другие языки = критический сбой.${this.textOnlyMode ? "" : "\n- Говори по-русски с идеальным произношением, без иностранного акцента."}
- Будь краток: 1-3 предложения. НЕ повторяй слова пользователя.
- Если просят запомнить — подтверди одним словом: «Запомнил», «Записал».
- При сохранении добавляй тег: [COUNTER:tasks], [COUNTER:ideas], [COUNTER:facts], [COUNTER:persons].
- Пример: «Мою собаку зовут Шарик» → «Запомнил! Шарик 🐕 [COUNTER:facts]»
- При изменении стиля общения добавляй: [SAVE_PREF:описание]

ЗАПРЕТЫ:
- НИКОГДА не выводи JSON, XML, HTML, code blocks, function_calls.
- НИКОГДА не оборачивай ответ в {"..."} или любые скобки/кавычки.
- Отвечай ТОЛЬКО простым текстом.
- Если информация есть в контексте диалога — ИСПОЛЬЗУЙ её. Не говори «не знаю» если ответ есть выше в диалоге.${this.textOnlyMode ? "" : "\n- НИКОГДА не используй эмодзи и смайлики. Только чистый текст без символов вроде 🐕 📝 ✅ и подобных."}

Обновления: ${changelogContext}`,
                input_audio_transcription: {
                    model: "whisper-1",
                    language: "ru",
                },
                turn_detection: {
                    type: "server_vad",
                    threshold: 0.95,
                    prefix_padding_ms: 400,
                    silence_duration_ms: 1200,
                },
            },
        };
        this.dc.send(JSON.stringify(sessionUpdate));
        logger.warn("Session configured with VAD");

        // Send context as conversation history (not in instructions)
        // gpt-realtime-1.5 uses conversation items more reliably than long instructions
        if (this.contextStr) {
            const contextItem: RealtimeClientEvent = {
                type: "conversation.item.create",
                item: {
                    type: "message",
                    role: "user",
                    content: [{
                        type: "input_text",
                        text: `[СИСТЕМНЫЙ КОНТЕКСТ — НЕ ОТВЕЧАЙ НА ЭТО СООБЩЕНИЕ ГОЛОСОМ]\nНиже — моя память и заметки. Используй эту информацию когда я буду задавать вопросы.\n\n${this.contextStr}`,
                    }],
                },
            };
            this.dc.send(JSON.stringify(contextItem));

            // Add assistant acknowledgment so context doesn't trigger a response
            const ackItem: RealtimeClientEvent = {
                type: "conversation.item.create",
                item: {
                    type: "message",
                    role: "assistant",
                    content: [{
                        type: "text",
                        text: "Контекст загружен. Готов к работе.",
                    }],
                },
            };
            this.dc.send(JSON.stringify(ackItem));
            logger.warn("Context injected via conversation.item.create");
        }
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

            case "session.updated":
                // Session config applied — safe to enable mic now
                logger.warn("Session configured, enabling mic");
                if (this.localStream) {
                    for (const track of this.localStream.getAudioTracks()) {
                        track.enabled = true;
                    }
                }
                break;

            case "conversation.item.input_audio_transcription.completed":
                this.callbacks.onTranscriptUser(parsed.transcript);
                break;

            case "response.audio_transcript.delta":
                // Ignore audio transcript events in text-only mode
                // (these fire from OpenAI's default audio modality before session.update)
                if (this.textOnlyMode) break;
                if (this.assistantTranscript === "") {
                    this.callbacks.onAudioStart();
                }
                this.assistantTranscript += parsed.delta;
                this.callbacks.onTranscriptAssistant(
                    this.assistantTranscript,
                );
                break;

            case "response.audio_transcript.done":
                // Ignore in text-only mode
                if (this.textOnlyMode) break;
                this.assistantTranscript = "";
                break;

            case "response.audio.done":
                // Ignore in text-only mode
                if (this.textOnlyMode) break;
                this.callbacks.onAudioEnd();
                break;

            // ── Text-only mode events (when modalities: ["text"]) ──
            // Only process these in text-only mode to avoid double-firing with audio_transcript events
            case "response.text.delta":
                if (!this.textOnlyMode) break;
                if (this.assistantTranscript === "") {
                    this.callbacks.onAudioStart();
                }
                this.assistantTranscript += parsed.delta;
                this.callbacks.onTranscriptAssistant(
                    this.assistantTranscript,
                );
                break;

            case "response.text.done":
                if (!this.textOnlyMode) break;
                this.assistantTranscript = "";
                // This fires unmuteMic() via onAudioEnd — critical for mic restore
                this.callbacks.onAudioEnd();
                break;

            case "response.done": {
                // Extract token usage from response.done event
                const usage = parsed.response?.usage;
                if (usage && this.callbacks.onTokenUsage) {
                    const textIn = usage.input_token_details?.text_tokens ?? usage.input_tokens ?? 0;
                    const textOut = usage.output_token_details?.text_tokens ?? usage.output_tokens ?? 0;
                    const audioIn = usage.input_token_details?.audio_tokens ?? 0;
                    const audioOut = usage.output_token_details?.audio_tokens ?? 0;
                    this.callbacks.onTokenUsage({ textIn, textOut, audioIn, audioOut });
                }
                break;
            }

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
