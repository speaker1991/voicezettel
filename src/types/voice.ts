import { z } from "zod";

// ── Voice session state ──────────────────────────────────────
export type VoiceSessionState =
    | "inactive"
    | "connecting"
    | "active"
    | "error";

// ── Ephemeral token response ─────────────────────────────────
export const EphemeralTokenResponseSchema = z.object({
    client_secret: z.object({
        value: z.string(),
    }),
});

export type EphemeralTokenResponse = z.infer<
    typeof EphemeralTokenResponseSchema
>;

// ── Data-channel event types (client → server) ───────────────
export type RealtimeClientEvent =
    | {
        type: "conversation.item.create";
        item: {
            type: "message";
            role: "user";
            content: Array<{
                type: "input_text";
                text: string;
            }>;
        };
    }
    | {
        type: "response.create";
    }
    | {
        type: "input_audio_buffer.commit";
    }
    | {
        type: "session.update";
        session: {
            modalities?: string[];
            instructions?: string;
            input_audio_transcription?: {
                model: string;
                language?: string;
            };
            turn_detection?: {
                type: "server_vad";
                threshold?: number;
                prefix_padding_ms?: number;
                silence_duration_ms?: number;
            };
        };
    };

// ── Data-channel event types (server → client) ───────────────
export type RealtimeServerEvent =
    | {
        type: "conversation.item.input_audio_transcription.completed";
        transcript: string;
    }
    | {
        type: "response.audio_transcript.delta";
        delta: string;
    }
    | {
        type: "response.audio_transcript.done";
        transcript: string;
    }
    | {
        type: "response.audio.done";
    }
    | {
        type: "response.done";
        response?: {
            usage?: {
                input_tokens?: number;
                output_tokens?: number;
                input_token_details?: {
                    text_tokens?: number;
                    audio_tokens?: number;
                    cached_tokens?: number;
                };
                output_token_details?: {
                    text_tokens?: number;
                    audio_tokens?: number;
                };
            };
        };
    }
    | {
        type: "input_audio_buffer.speech_started";
    }
    | {
        type: "input_audio_buffer.speech_stopped";
    }
    | {
        type: "session.created";
    }
    | {
        type: "session.updated";
    }
    | {
        type: "error";
        error: {
            message: string;
            type: string;
            code: string;
        };
    };
