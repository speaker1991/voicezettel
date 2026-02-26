import { z } from "zod";

// ── Zod schemas ──────────────────────────────────────────────
export const MessageMetadataSchema = z.object({
    rewardType: z
        .enum(["note", "insight", "rag", "task"])
        .optional(),
});

export const MessageSchema = z.object({
    id: z.string(),
    role: z.enum(["user", "assistant", "system"]),
    content: z.string(),
    timestamp: z.string(),
    source: z.enum(["voice", "text"]),
    metadata: MessageMetadataSchema.optional(),
});

// ── Inferred TypeScript types ────────────────────────────────
export type Message = z.infer<typeof MessageSchema>;
export type MessageMetadata = z.infer<typeof MessageMetadataSchema>;

export type SessionStatus = {
    server: boolean;
    obsidian: boolean;
};

export type OrbState =
    | "idle"
    | "listening"
    | "thinking"
    | "speaking"
    | "backgroundListening";

export type ModalityMode = "text" | "voice";
