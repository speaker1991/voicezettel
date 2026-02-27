import { create } from "zustand";
import type { CountersState, CountersActions } from "@/types/counters";

export const useCountersStore = create<CountersState & CountersActions>()(
    (set) => ({
        ideas: 0,
        facts: 0,
        persons: 0,
        tasks: 0,
        tokensUsd: 0.04,
        tokensRub: 3.6,
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
    }),
);
