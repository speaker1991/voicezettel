"use client";

import { AiOrb } from "@/components/orb/AiOrb";
import { useChatStore } from "@/stores/chatStore";
import type { OrbState } from "@/types/chat";

const STATE_LABELS: Record<OrbState, string> = {
    idle: "Idle",
    listening: "Listening…",
    thinking: "Connecting…",
    speaking: "Speaking…",
    backgroundListening: "Background",
};

export function OrbArea() {
    const orbState = useChatStore((s) => s.orbState);
    const audioLevel = useChatStore((s) => s.audioLevel);

    return (
        <div className="flex flex-col items-center justify-center gap-4 py-8">
            <AiOrb
                state={orbState}
                audioLevel={audioLevel}
            />
            <span className="text-xs tracking-wide text-zinc-500">
                {STATE_LABELS[orbState]}
            </span>
        </div>
    );
}
