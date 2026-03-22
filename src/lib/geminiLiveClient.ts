// src/lib/geminiLiveClient.ts
// Утилита для Gemini Live WebSocket Speech-to-Speech.
// Вызывается из useVoiceSession только при voiceMode === 'gemini-live'.

import { logger } from "@/lib/logger";

let ws: WebSocket | null = null;
let micStream: MediaStream | null = null;
let audioCtx: AudioContext | null = null;
let processor: ScriptProcessorNode | null = null;

interface GeminiLiveOptions {
    wsUrl: string;
    micStream: MediaStream;
    onTranscript: (text: string) => void;
    onOrbState: (state: "listening" | "thinking" | "speaking" | "idle") => void;
    onAudioLevel: (level: number) => void;
    onMessage: (userText: string, assistantText: string) => void;
    onLog: (msg: string, data?: unknown) => void;
}

export function connectGeminiLive(opts: GeminiLiveOptions) {
    opts.onLog("WS открывается...");
    ws = new WebSocket(opts.wsUrl);

    ws.onopen = () => {
        opts.onLog("WS подключён, отправляю setup");
        ws!.send(JSON.stringify({
            setup: {
                model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
                generation_config: {
                    response_modalities: ["AUDIO"],
                    speech_config: {
                        voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } },
                    },
                },
            },
        }));
        opts.onOrbState("listening");
        void startMicFromStream(opts.micStream, opts);
    };

    let assistantTextBuffer = "";
    let userTextBuffer = "";

    ws.onmessage = async (event: MessageEvent) => {
        const raw: string = event.data instanceof Blob
            ? await event.data.text()
            : (event.data as string);
        let data: Record<string, unknown>;
        try {
            data = JSON.parse(raw) as Record<string, unknown>;
        } catch {
            return;
        }

        const serverContent = data.serverContent as Record<string, unknown> | undefined;
        if (serverContent?.modelTurn) {
            opts.onOrbState("speaking");
            const modelTurn = serverContent.modelTurn as Record<string, unknown>;
            const parts = (modelTurn.parts as Array<Record<string, unknown>>) ?? [];
            for (const part of parts) {
                const inlineData = part.inlineData as Record<string, unknown> | undefined;
                if (
                    inlineData?.mimeType === "audio/pcm" &&
                    typeof inlineData.data === "string"
                ) {
                    opts.onLog("аудио получено");
                    playPCM(inlineData.data, opts);
                }
                if (typeof part.text === "string") {
                    assistantTextBuffer += part.text;
                    opts.onTranscript(part.text);
                }
            }
        }

        const inputTranscription = serverContent?.inputTranscription as Record<string, unknown> | undefined;
        if (typeof inputTranscription?.text === "string") {
            userTextBuffer = inputTranscription.text;
        }

        if (serverContent?.turnComplete) {
            opts.onOrbState("listening");
            if (userTextBuffer || assistantTextBuffer) {
                opts.onMessage(userTextBuffer, assistantTextBuffer);
            }
            userTextBuffer = "";
            assistantTextBuffer = "";
        }
    };

    ws.onerror = (e) => {
        opts.onLog("WS ошибка", e);
        opts.onOrbState("idle");
    };
    ws.onclose = () => {
        opts.onLog("WS закрыт");
        opts.onOrbState("idle");
    };
}

export function disconnectGeminiLive() {
    processor?.disconnect();
    processor = null;
    audioCtx?.close().catch(() => { /* silent */ });
    audioCtx = null;
    if (micStream) {
        micStream.getTracks().forEach((t) => t.stop());
        micStream = null;
    }
    ws?.close();
    ws = null;
}

async function startMicFromStream(stream: MediaStream, opts: GeminiLiveOptions) {
    micStream = stream;
    audioCtx = new AudioContext({ sampleRate: 16000 });
    if (audioCtx.state === "suspended") {
        await audioCtx.resume();
    }
    const source = audioCtx.createMediaStreamSource(stream);
    processor = audioCtx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e: AudioProcessingEvent) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const float32 = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
            pcm16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
        }
        const bytes = new Uint8Array(pcm16.buffer as ArrayBuffer);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        const b64 = btoa(binary);

        // Visualize mic level
        const rms = Math.sqrt(float32.reduce((s, v) => s + v * v, 0) / float32.length);
        opts.onAudioLevel(Math.min(1, rms * 8));

        ws.send(JSON.stringify({
            realtime_input: {
                media_chunks: [{ mime_type: "audio/pcm", data: b64 }],
            },
        }));
    };

    source.connect(processor);
    processor.connect(audioCtx.destination);
    logger.info("[GeminiLive] Mic capture started (16kHz)");
}

function playPCM(base64: string, opts: GeminiLiveOptions) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const pcm16 = new Int16Array(bytes.buffer as ArrayBuffer);

    const ctx = new AudioContext({ sampleRate: 24000 });
    const buffer = ctx.createBuffer(1, pcm16.length, 24000);
    const float32 = buffer.getChannelData(0);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start();

    // Visualize playback level
    const rms = Math.sqrt(float32.reduce((s, v) => s + v * v, 0) / float32.length);
    opts.onAudioLevel(Math.min(1, rms * 8));
}
