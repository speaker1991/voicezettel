"use client";

import { useCallback } from "react";
import { AiOrb } from "@/components/orb/AiOrb";
import { useChatStore } from "@/stores/chatStore";
import type { OrbState } from "@/types/chat";

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
    const orbState = useChatStore((s) => s.orbState);
    const audioLevel = useChatStore((s) => s.audioLevel);
    const setOrbState = useChatStore((s) => s.setOrbState);

    const cycleState = useCallback(() => {
        const idx = STATE_CYCLE.indexOf(orbState);
        const next = STATE_CYCLE[(idx + 1) % STATE_CYCLE.length];
        setOrbState(next);
    }, [orbState, setOrbState]);

    return (
        <div className="flex flex-col items-center justify-center gap-4 py-8">
            <AiOrb
                state={orbState}
                audioLevel={audioLevel}
                onClick={cycleState}
            />
            <span className="text-xs tracking-wide text-zinc-500">
                {STATE_LABELS[orbState]}
            </span>
        </div>
    );
}
