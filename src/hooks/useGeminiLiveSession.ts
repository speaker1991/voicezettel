"use client";

import { useState, useRef, useCallback } from "react";
import { logger } from "@/lib/logger";

/* ------------------------------------------------------------------ */
/*  Types for Gemini Live WebSocket protocol                          */
/* ------------------------------------------------------------------ */

interface GeminiSetupMessage {
    setup: {
        model: string;
        generation_config: {
            response_modalities: string[];
            speech_config: {
                voice_config: {
                    prebuilt_voice_config: { voice_name: string };
                };
            };
        };
        system_instruction?: { parts: { text: string }[] };
    };
}

interface GeminiRealtimeInput {
    realtime_input: {
        media_chunks: { mime_type: string; data: string }[];
    };
}

interface GeminiInlineData {
    mimeType: string;
    data: string;
}

interface GeminiPart {
    text?: string;
    inlineData?: GeminiInlineData;
}

interface GeminiServerMessage {
    setupComplete?: unknown;
    serverContent?: {
        modelTurn?: {
            parts?: GeminiPart[];
        };
        turnComplete?: boolean;
    };
}

interface TokenResponse {
    wsUrl: string;
    model: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Convert Float32 [-1,1] → Int16 PCM bytes */
function float32ToInt16(buffer: Float32Array): Int16Array {
    const out = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
        const s = Math.max(-1, Math.min(1, buffer[i]));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
}

/** Encode ArrayBuffer → base64 string */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/** Decode base64 → ArrayBuffer */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

/** Convert Int16 PCM → Float32 for AudioBuffer */
function int16ToFloat32(int16: Int16Array): Float32Array {
    const out = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
        out[i] = int16[i] / 0x8000;
    }
    return out;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useGeminiLiveSession() {
    const [isConnected, setIsConnected] = useState(false);
    const [transcript, setTranscript] = useState("");

    const wsRef = useRef<WebSocket | null>(null);
    const micStreamRef = useRef<MediaStream | null>(null);
    const micAudioCtxRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const playbackCtxRef = useRef<AudioContext | null>(null);

    /* ── Play received PCM audio ── */
    const playPcmAudio = useCallback((base64Data: string) => {
        const rawBuf = base64ToArrayBuffer(base64Data);
        const int16 = new Int16Array(rawBuf);
        const float32 = int16ToFloat32(int16);

        const PLAYBACK_SAMPLE_RATE = 24000;

        if (!playbackCtxRef.current || playbackCtxRef.current.state === "closed") {
            playbackCtxRef.current = new AudioContext({ sampleRate: PLAYBACK_SAMPLE_RATE });
        }

        const ctx = playbackCtxRef.current;
        const audioBuffer = ctx.createBuffer(1, float32.length, PLAYBACK_SAMPLE_RATE);
        audioBuffer.copyToChannel(new Float32Array(float32.buffer as ArrayBuffer), 0);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.start();
    }, []);

    /* ── Handle incoming WS messages ── */
    const handleMessage = useCallback(
        (event: MessageEvent) => {
            try {
                const msg = JSON.parse(event.data as string) as GeminiServerMessage;

                if (msg.setupComplete) {
                    logger.info("[GeminiLive] Setup complete, session ready");
                    return;
                }

                const parts = msg.serverContent?.modelTurn?.parts;
                if (!parts) return;

                for (const part of parts) {
                    if (part.inlineData?.mimeType === "audio/pcm" && part.inlineData.data) {
                        playPcmAudio(part.inlineData.data);
                    }
                    if (part.text) {
                        setTranscript((prev) => prev + part.text);
                    }
                }
            } catch (err) {
                logger.error("[GeminiLive] Failed to parse message:", err);
            }
        },
        [playPcmAudio],
    );

    /* ── Connect ── */
    const connect = useCallback(
        async (systemPrompt?: string) => {
            // 1. СНАЧАЛА микрофон — в user gesture context (до любых async)
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                },
            });
            micStreamRef.current = stream;

            // 2. Fetch token / wsUrl
            const res = await fetch("/api/gemini-live-token", { method: "POST" });
            if (!res.ok) {
                stream.getTracks().forEach((t) => t.stop());
                const body = await res.text();
                throw new Error(`Token fetch failed: ${body}`);
            }
            const { wsUrl, model } = (await res.json()) as TokenResponse;

            // 3. Open WebSocket
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                logger.info("[GeminiLive] WebSocket connected, sending setup");

                // Send setup message
                const setupMsg: GeminiSetupMessage = {
                    setup: {
                        model: `models/${model}`,
                        generation_config: {
                            response_modalities: ["AUDIO"],
                            speech_config: {
                                voice_config: {
                                    prebuilt_voice_config: { voice_name: "Aoede" },
                                },
                            },
                        },
                    },
                };

                if (systemPrompt) {
                    setupMsg.setup.system_instruction = {
                        parts: [{ text: systemPrompt }],
                    };
                }

                ws.send(JSON.stringify(setupMsg));
                setIsConnected(true);
                setTranscript("");

                // Start mic capture with already-acquired stream
                void startMicCapture(ws, stream);
            };

            ws.onmessage = handleMessage;

            ws.onerror = (ev) => {
                logger.error("[GeminiLive] WebSocket error:", ev);
            };

            ws.onclose = () => {
                logger.info("[GeminiLive] WebSocket closed");
                setIsConnected(false);
                cleanupMic();
            };
        },
        [handleMessage],
    );

    /* ── Microphone capture ── */
    const startMicCapture = async (ws: WebSocket, stream: MediaStream) => {

        const ctx = new AudioContext({ sampleRate: 16000 });
        if (ctx.state === "suspended") {
            await ctx.resume();
        }
        micAudioCtxRef.current = ctx;

        const source = ctx.createMediaStreamSource(stream);
        const processor = ctx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
            if (ws.readyState !== WebSocket.OPEN) return;

            const inputData = e.inputBuffer.getChannelData(0);
            const pcm16 = float32ToInt16(inputData);
            const base64 = arrayBufferToBase64(pcm16.buffer as ArrayBuffer);

            const msg: GeminiRealtimeInput = {
                realtime_input: {
                    media_chunks: [
                        { mime_type: "audio/pcm", data: base64 },
                    ],
                },
            };

            ws.send(JSON.stringify(msg));
        };

        source.connect(processor);
        processor.connect(ctx.destination);
    };

    /* ── Cleanup mic resources ── */
    const cleanupMic = useCallback(() => {
        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
        }
        if (micAudioCtxRef.current && micAudioCtxRef.current.state !== "closed") {
            micAudioCtxRef.current.close().catch(() => { /* silent */ });
            micAudioCtxRef.current = null;
        }
        if (micStreamRef.current) {
            micStreamRef.current.getTracks().forEach((t) => t.stop());
            micStreamRef.current = null;
        }
    }, []);

    /* ── Disconnect ── */
    const disconnect = useCallback(() => {
        cleanupMic();

        if (playbackCtxRef.current && playbackCtxRef.current.state !== "closed") {
            playbackCtxRef.current.close().catch(() => { /* silent */ });
            playbackCtxRef.current = null;
        }

        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }

        setIsConnected(false);
    }, [cleanupMic]);

    return { connect, disconnect, isConnected, transcript } as const;
}
