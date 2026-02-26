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
            input_audio_transcription?: {
                model: string;
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
