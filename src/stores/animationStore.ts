import { create } from "zustand";
import type { CounterType, FlyingAnimation } from "@/types/animation";

interface AnimationState {
    pendingAnimations: FlyingAnimation[];
}

interface AnimationActions {
    triggerAnimation: (counterType: CounterType) => void;
    removeAnimation: (id: string) => void;
}

export const useAnimationStore = create<AnimationState & AnimationActions>()(
    (set) => ({
        pendingAnimations: [],

        triggerAnimation: (counterType) =>
            set((state) => ({
                pendingAnimations: [
                    ...state.pendingAnimations,
                    { id: crypto.randomUUID(), counterType },
                ],
            })),

        removeAnimation: (id) =>
            set((state) => ({
                pendingAnimations: state.pendingAnimations.filter(
                    (a) => a.id !== id,
                ),
            })),
    }),
);
