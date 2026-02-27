"use client";

import { useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Lightbulb, Heart, Users, ListChecks } from "lucide-react";
import type { CounterType } from "@/types/animation";
import { useAnimationStore } from "@/stores/animationStore";
import { useCountersStore } from "@/stores/countersStore";
import { playCounterDing } from "@/lib/sounds";
import { ParticleBurst } from "./ParticleBurst";

const ICON_MAP: Record<CounterType, React.ElementType> = {
    ideas: Lightbulb,
    facts: Heart,
    persons: Users,
    tasks: ListChecks,
};

const INCREMENT_MAP: Record<CounterType, string> = {
    ideas: "incrementIdeas",
    facts: "incrementFacts",
    persons: "incrementPersons",
    tasks: "incrementTasks",
};

interface FlyingIconInstanceProps {
    id: string;
    counterType: CounterType;
}

function computeOrbCenter() {
    const orbEl = document.querySelector("[data-orb-center]");
    if (orbEl) {
        const rect = orbEl.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

function computeCounterCenter(counterType: CounterType) {
    const badgeEl = document.querySelector(`[data-counter-type="${counterType}"]`);
    if (badgeEl) {
        const rect = badgeEl.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    return { x: 0, y: 0 };
}

function FlyingIconInstance({ id, counterType }: FlyingIconInstanceProps) {
    const Icon = ICON_MAP[counterType];
    const removeAnimation = useAnimationStore((s) => s.removeAnimation);
    const [phase, setPhase] = useState<"flying" | "burst" | "done">("flying");
    const hasTriggered = useRef(false);

    // Lazy initializers run once — read DOM synchronously without useEffect
    const [startPos] = useState(computeOrbCenter);
    const [targetPos] = useState(() => computeCounterCenter(counterType));

    const handleFlyComplete = useCallback(() => {
        if (hasTriggered.current) return;
        hasTriggered.current = true;

        // Play subtle ding sound
        playCounterDing();

        // Increment counter
        const action = INCREMENT_MAP[counterType] as keyof ReturnType<
            typeof useCountersStore.getState
        >;
        const fn = useCountersStore.getState()[action];
        if (typeof fn === "function") {
            (fn as () => void)();
        }

        // Transition to burst
        setPhase("burst");
    }, [counterType]);

    const handleBurstComplete = useCallback(() => {
        setPhase("done");
        removeAnimation(id);
    }, [id, removeAnimation]);

    if (phase === "done") return null;

    if (phase === "burst") {
        return (
            <ParticleBurst
                x={targetPos.x}
                y={targetPos.y}
                onComplete={handleBurstComplete}
            />
        );
    }

    // Calculate arc control point for curved flight path
    const midX = (startPos.x + targetPos.x) / 2;
    const midY = Math.min(startPos.y, targetPos.y) - 60;

    return (
        <motion.div
            initial={{
                x: startPos.x - 10,
                y: startPos.y - 10,
                scale: 1.2,
                opacity: 0.9,
            }}
            animate={{
                x: [startPos.x - 10, midX - 10, targetPos.x - 10],
                y: [startPos.y - 10, midY - 10, targetPos.y - 10],
                scale: [1.2, 1, 0.6],
                opacity: [0.9, 1, 1],
            }}
            transition={{
                duration: 0.6,
                ease: "easeInOut",
                times: [0, 0.5, 1],
            }}
            onAnimationComplete={handleFlyComplete}
            style={{
                position: "fixed",
                pointerEvents: "none",
                zIndex: 9999,
            }}
        >
            <div className="flex items-center justify-center rounded-full bg-violet-500/30 p-1.5 shadow-[0_0_12px_rgba(139,92,246,0.6)]">
                <Icon className="size-4 text-violet-300" />
            </div>
        </motion.div>
    );
}

export function AnimationOverlay() {
    const pendingAnimations = useAnimationStore((s) => s.pendingAnimations);

    if (pendingAnimations.length === 0) return null;

    return (
        <>
            {pendingAnimations.map((anim) => (
                <FlyingIconInstance
                    key={anim.id}
                    id={anim.id}
                    counterType={anim.counterType}
                />
            ))}
        </>
    );
}
