import { create } from "zustand";
import type { CountersState, CountersActions } from "@/types/counters";
import type { TokenUsageResponse } from "@/types/tokenUsage";
import { logger } from "@/lib/logger";

export const useCountersStore = create<CountersState & CountersActions>()(
    (set) => ({
        ideas: 0,
        facts: 0,
        persons: 0,
        tasks: 0,
        tokensUsd: 0,
        tokensRub: 0,
        tokensBalance: 0,

        incrementIdeas: () => set((s) => ({ ideas: s.ideas + 1 })),
        incrementFacts: () => set((s) => ({ facts: s.facts + 1 })),
        incrementPersons: () => set((s) => ({ persons: s.persons + 1 })),
        incrementTasks: () => set((s) => ({ tasks: s.tasks + 1 })),
        setTokensUsd: (value) => set({ tokensUsd: value }),
        setTokensRub: (value) => set({ tokensRub: value }),
        setTokensBalance: (value) => set({ tokensBalance: value }),
        addTokensUsed: (count) =>
            set((s) => ({ tokensBalance: s.tokensBalance + count })),

        loadTokensFromServer: async (userId: string) => {
            try {
                const res = await fetch(
                    `/api/token-usage?userId=${encodeURIComponent(userId)}`,
                );
                if (!res.ok) return;
                const data = (await res.json()) as TokenUsageResponse;
                set({
                    tokensBalance: data.totalTokens,
                    tokensUsd: data.totalCostUsd,
                    tokensRub: data.totalCostRub,
                });
            } catch (err) {
                logger.error("Failed to load token usage:", (err as Error).message);
            }
        },

        reportTokenUsage: async (
            userId: string,
            model: string,
            textIn: number,
            textOut: number,
            audioIn = 0,
            audioOut = 0,
        ) => {
            try {
                const res = await fetch("/api/token-usage", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        userId,
                        model,
                        textIn,
                        textOut,
                        audioIn,
                        audioOut,
                    }),
                });
                if (!res.ok) return;
                const data = (await res.json()) as TokenUsageResponse;
                set({
                    tokensBalance: data.totalTokens,
                    tokensUsd: data.totalCostUsd,
                    tokensRub: data.totalCostRub,
                });
            } catch (err) {
                logger.error("Failed to report token usage:", (err as Error).message);
            }
        },
    }),
);
