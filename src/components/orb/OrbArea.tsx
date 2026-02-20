"use client";

import { useCallback, useState } from "react";
import { AiOrb, type OrbState } from "@/components/orb/AiOrb";

const STATE_CYCLE: OrbState[] = [
    "idle",
    "listening",
    "thinking",
    "speaking",
    "backgroundListening",
];

const STATE_LABELS: Record<OrbState, string> = {
    idle: "Idle",
    listening: "Listening",
    thinking: "Thinking",
    speaking: "Speaking",
    backgroundListening: "Background",
};

export function OrbArea() {
    const [stateIndex, setStateIndex] = useState(0);

    const currentState = STATE_CYCLE[stateIndex];

    const cycleState = useCallback(() => {
        setStateIndex((prev) => (prev + 1) % STATE_CYCLE.length);
    }, []);

    return (
        <div className="flex flex-col items-center justify-center gap-4 py-8">
            <AiOrb
                state={currentState}
                audioLevel={currentState === "listening" ? 0.6 : 0}
                onClick={cycleState}
            />
            <span className="text-xs tracking-wide text-zinc-500">
                {STATE_LABELS[currentState]}
            </span>
        </div>
    );
}
