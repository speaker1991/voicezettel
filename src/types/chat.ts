export type Message = {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: string;
    source: "voice" | "text";
    metadata?: {
        rewardType?: "note" | "insight" | "rag" | "task";
    };
};

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
