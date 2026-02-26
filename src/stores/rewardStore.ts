import { create } from "zustand";
import type { Reward } from "@/types/reward";

interface RewardState {
    pendingRewards: Reward[];
}

interface RewardActions {
    addReward: (reward: Reward) => void;
    consumeReward: (id: string) => void;
}

export const useRewardStore = create<RewardState & RewardActions>()(
    (set) => ({
        pendingRewards: [],

        addReward: (reward) =>
            set((state) => ({
                pendingRewards: [...state.pendingRewards, reward],
            })),

        consumeReward: (id) =>
            set((state) => ({
                pendingRewards: state.pendingRewards.filter(
                    (r) => r.id !== id,
                ),
            })),
    }),
);
