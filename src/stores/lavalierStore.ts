import { create } from "zustand";
import type { TranscriptEntry, LavalierState } from "@/types/lavalier";

interface LavalierStoreState {
    state: LavalierState;
    transcript: TranscriptEntry[];
    meetingStartedAt: string | null;
    summary: string | null;
    isGeneratingSummary: boolean;
}

interface LavalierStoreActions {
    startMeeting: () => void;
    pauseMeeting: () => void;
    resumeMeeting: () => void;
    stopMeeting: () => void;
    addTranscriptEntry: (text: string) => void;
    setSummary: (summary: string) => void;
    setIsGeneratingSummary: (val: boolean) => void;
    clear: () => void;
}

export const useLavalierStore = create<LavalierStoreState & LavalierStoreActions>()(
    (set) => ({
        state: "inactive",
        transcript: [],
        meetingStartedAt: null,
        summary: null,
        isGeneratingSummary: false,

        startMeeting: () =>
            set({
                state: "listening",
                transcript: [],
                meetingStartedAt: new Date().toISOString(),
                summary: null,
            }),

        pauseMeeting: () => set({ state: "paused" }),

        resumeMeeting: () => set({ state: "listening" }),

        stopMeeting: () => set({ state: "inactive" }),

        addTranscriptEntry: (text) =>
            set((s) => ({
                transcript: [
                    ...s.transcript,
                    {
                        id: crypto.randomUUID(),
                        text,
                        timestamp: new Date().toISOString(),
                        speaker: "unknown",
                    },
                ],
            })),

        setSummary: (summary) => set({ summary }),

        setIsGeneratingSummary: (isGeneratingSummary) =>
            set({ isGeneratingSummary }),

        clear: () =>
            set({
                state: "inactive",
                transcript: [],
                meetingStartedAt: null,
                summary: null,
                isGeneratingSummary: false,
            }),
    }),
);
