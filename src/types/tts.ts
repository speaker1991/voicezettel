export interface TTSRequest {
    text: string;
    voice?: string;
}

export type TtsProvider = "browser" | "edge";

/** Available Russian Edge TTS voices */
export const EDGE_VOICES = [
    { id: "ru-RU-SvetlanaNeural", label: "Светлана (жен.)", gender: "female" },
    { id: "ru-RU-DariyaNeural", label: "Дарья (жен.)", gender: "female" },
    { id: "ru-RU-DmitryNeural", label: "Дмитрий (муж.)", gender: "male" },
] as const;
