"use client";

import { motion, type Variants } from "framer-motion";

type OrbState =
    | "idle"
    | "listening"
    | "thinking"
    | "speaking"
    | "backgroundListening";

interface AiOrbProps {
    state: OrbState;
    audioLevel?: number;
    onClick?: () => void;
}

const GLOW_VIOLET = "rgba(139,92,246,";
const GLOW_BLUE = "rgba(59,130,246,";

function getGlowShadow(intensity: number, color = GLOW_VIOLET): string {
    return `0 0 ${40 * intensity}px ${12 * intensity}px ${color}${0.3 * intensity}), 0 0 ${80 * intensity}px ${24 * intensity}px ${color}${0.15 * intensity})`;
}

const orbVariants: Variants = {
    idle: {
        scale: [0.95, 1.05, 0.95],
        boxShadow: [
            getGlowShadow(0.4),
            getGlowShadow(0.7),
            getGlowShadow(0.4),
        ],
        transition: {
            duration: 4,
            repeat: Infinity,
            ease: "easeInOut",
        },
    },
    thinking: {
        scale: 1,
        rotate: [0, 360],
        boxShadow: [
            getGlowShadow(0.6, GLOW_VIOLET),
            getGlowShadow(0.6, GLOW_BLUE),
            getGlowShadow(0.6, GLOW_VIOLET),
        ],
        transition: {
            rotate: { duration: 3, repeat: Infinity, ease: "linear" },
            boxShadow: { duration: 2, repeat: Infinity, ease: "easeInOut" },
            scale: { duration: 0.4 },
        },
    },
    speaking: {
        scale: [1, 1.08, 0.96, 1.04, 1],
        boxShadow: [
            getGlowShadow(0.7),
            getGlowShadow(1),
            getGlowShadow(0.5),
            getGlowShadow(0.9),
            getGlowShadow(0.7),
        ],
        transition: {
            duration: 1.2,
            repeat: Infinity,
            ease: "easeInOut",
        },
    },
    backgroundListening: {
        scale: 0.4,
        boxShadow: getGlowShadow(0.2),
        transition: {
            duration: 0.6,
            ease: "easeOut",
        },
    },
};

function getBackgroundForState(state: OrbState): string {
    if (state === "thinking") {
        return "radial-gradient(circle at 30% 30%, #7c3aed, #3b82f6, #7c3aed)";
    }
    return "radial-gradient(circle at 40% 35%, #a78bfa, #7c3aed 50%, #4c1d95)";
}

function getListeningAnimation(audioLevel: number) {
    const scaleMid = 1 + audioLevel * 0.15;
    const glowIntensity = 0.5 + audioLevel * 0.5;

    return {
        scale: [1, scaleMid, 1],
        boxShadow: [
            getGlowShadow(glowIntensity * 0.6),
            getGlowShadow(glowIntensity),
            getGlowShadow(glowIntensity * 0.6),
        ],
        transition: {
            duration: 0.6,
            repeat: Infinity,
            ease: "easeInOut" as const,
        },
    };
}

export function AiOrb({ state, audioLevel = 0, onClick }: AiOrbProps) {
    const isListening = state === "listening";

    const animate = isListening
        ? getListeningAnimation(audioLevel)
        : state;

    return (
        <motion.div
            className="relative cursor-pointer select-none"
            onClick={onClick}
        >
            {/* Outer ring for listening state */}
            {isListening && (
                <motion.div
                    className="absolute inset-0 rounded-full border border-violet-400/30"
                    initial={{ scale: 1, opacity: 0.6 }}
                    animate={{
                        scale: [1, 1.4, 1],
                        opacity: [0.6, 0, 0.6],
                    }}
                    transition={{
                        duration: 1.2,
                        repeat: Infinity,
                        ease: "easeOut",
                    }}
                />
            )}

            {/* Main orb */}
            <motion.div
                className="size-[120px] rounded-full sm:size-[180px]"
                style={{ background: getBackgroundForState(state) }}
                variants={orbVariants}
                animate={animate}
                whileHover={{ scale: state === "backgroundListening" ? 0.45 : 1.08 }}
                whileTap={{ scale: state === "backgroundListening" ? 0.38 : 0.95 }}
            />
        </motion.div>
    );
}

export type { OrbState };
