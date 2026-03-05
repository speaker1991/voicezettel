export interface TTSRequest {
    text: string;
    voiceId?: string;
}

export type TtsProvider = "browser" | "elevenlabs";
