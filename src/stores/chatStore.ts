import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Message, OrbState, ModalityMode } from "@/types/chat";

export type OrbMode = "voice" | "lavalier" | "agent";

interface ChatState {
    messages: Message[];
    orbState: OrbState;
    modality: ModalityMode;
    audioLevel: number;
    orbMode: OrbMode;
    liveTranscript: string;
    sessionId?: string;
}

interface ChatActions {
    addMessage: (message: Message) => void;
    updateLastAssistantMessage: (partial: Partial<Message>) => void;
    insertMessageBeforeLastAssistant: (message: Message) => void;
    setOrbState: (state: OrbState) => void;
    setModality: (mode: ModalityMode) => void;
    setAudioLevel: (level: number) => void;
    setOrbMode: (mode: OrbMode) => void;
    setLiveTranscript: (text: string) => void;
    clearMessages: () => void;
}

const SEED_MESSAGES: Message[] = [
    {
        id: "seed-1",
        role: "assistant",
        content: "Привет! Я VoiceZettel — твой голосовой помощник для заметок. Спрашивай что угодно или надиктуй мысль 🎙",
        timestamp: "2025-01-01T00:00:00.000Z",
        source: "text",
    },
];

export const useChatStore = create<ChatState & ChatActions>()(
    persist(
        (set) => ({
            messages: SEED_MESSAGES,
            orbState: "idle",
            modality: "voice",
            audioLevel: 0,
            orbMode: "voice" as OrbMode,
            liveTranscript: "",
            sessionId: undefined,

            addMessage: (message) =>
                set((state) => ({ messages: [...state.messages, message] })),

            updateLastAssistantMessage: (partial) =>
                set((state) => {
                    const idx = [...state.messages]
                        .reverse()
                        .findIndex((m) => m.role === "assistant");
                    if (idx === -1) return state;

                    const realIdx = state.messages.length - 1 - idx;
                    const updated = [...state.messages];
                    updated[realIdx] = { ...updated[realIdx], ...partial };
                    return { messages: updated };
                }),

            insertMessageBeforeLastAssistant: (message) =>
                set((state) => {
                    const idx = [...state.messages]
                        .reverse()
                        .findIndex((m) => m.role === "assistant");
                    if (idx === -1) return { messages: [...state.messages, message] };

                    const realIdx = state.messages.length - 1 - idx;
                    const updated = [...state.messages];
                    updated.splice(realIdx, 0, message);
                    return { messages: updated };
                }),

            setOrbState: (orbState) => set({ orbState }),
            setModality: (modality) => set({ modality }),
            setAudioLevel: (audioLevel) => set({ audioLevel }),
            setOrbMode: (orbMode) => set({ orbMode }),
            setLiveTranscript: (liveTranscript) => set({ liveTranscript }),
            clearMessages: () => set({ messages: SEED_MESSAGES }),
        }),
        {
            name: "voicezettel-chat",
            // Only persist orbMode, NOT messages — chat resets on refresh
            partialize: (state) => ({
                orbMode: state.orbMode,
            }),
            version: 1,
            migrate: (persisted) => {
                const state = persisted as Record<string, unknown>;
                // Drop persisted messages — chat starts fresh each session
                delete state.messages;
                return state;
            },
        },
    ),
);
