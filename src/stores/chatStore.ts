import { create } from "zustand";
import type { Message, OrbState, ModalityMode } from "@/types/chat";

interface ChatState {
    messages: Message[];
    orbState: OrbState;
    modality: ModalityMode;
    audioLevel: number;
    sessionId?: string;
}

interface ChatActions {
    addMessage: (message: Message) => void;
    updateLastAssistantMessage: (partial: Partial<Message>) => void;
    insertMessageBeforeLastAssistant: (message: Message) => void;
    setOrbState: (state: OrbState) => void;
    setModality: (mode: ModalityMode) => void;
    setAudioLevel: (level: number) => void;
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
    {
        id: "seed-2",
        role: "user",
        content: "Покажи мне последние заметки",
        timestamp: "2025-01-01T00:00:01.000Z",
        source: "voice",
    },
    {
        id: "seed-3",
        role: "assistant",
        content: "Пока у меня нет подключения к Obsidian. Настрой интеграцию в разделе ⚙️ Settings, и я смогу искать по твоим заметкам.",
        timestamp: "2025-01-01T00:00:02.000Z",
        source: "text",
        metadata: { rewardType: "insight" },
    },
];

export const useChatStore = create<ChatState & ChatActions>()((set) => ({
    messages: SEED_MESSAGES,
    orbState: "idle",
    modality: "voice",
    audioLevel: 0,
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
    clearMessages: () => set({ messages: [] }),
}));
