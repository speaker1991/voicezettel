"use client";

import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence, type PanInfo } from "framer-motion";
import { ParticleOrb } from "@/components/orb/ParticleOrb";
import { LavalierOrb } from "@/components/orb/LavalierOrb";
import { MeetingSummary } from "@/components/orb/MeetingSummary";
import { useChatStore } from "@/stores/chatStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useVoiceSession } from "@/hooks/useVoiceSession";
import { warmUpAudio } from "@/lib/sounds";
import type { OrbState } from "@/types/chat";

const STATE_LABELS: Record<OrbState, string> = {
    idle: "Idle",
    listening: "Listening…",
    thinking: "Thinking…",
    speaking: "Speaking…",
    backgroundListening: "Background",
};

type OrbMode = "voice" | "lavalier";

const SWIPE_THRESHOLD = 80;

export function OrbArea() {
    const orbState = useChatStore((s) => s.orbState);
    const audioLevel = useChatStore((s) => s.audioLevel);
    const orbParticles = useSettingsStore((s) => s.orbParticles);
    const { isVoiceActive, startVoice, stopVoice } = useVoiceSession();

    const [mode, setMode] = useState<OrbMode>("voice");
    const [showSummary, setShowSummary] = useState(false);
    const [showHint, setShowHint] = useState(true);

    // Auto-hide hint after 4 seconds
    useEffect(() => {
        const timer = setTimeout(() => setShowHint(false), 4000);
        return () => clearTimeout(timer);
    }, []);

    const handleOrbClick = useCallback(() => {
        warmUpAudio();
        setShowHint(false);
        if (isVoiceActive) {
            stopVoice();
        } else {
            startVoice();
        }
    }, [isVoiceActive, startVoice, stopVoice]);

    const handleDragEnd = useCallback(
        (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
            if (info.offset.x < -SWIPE_THRESHOLD && mode === "voice") {
                setMode("lavalier");
            } else if (info.offset.x > SWIPE_THRESHOLD && mode === "lavalier") {
                setMode("voice");
            }
        },
        [mode],
    );

    const handleEndMeeting = useCallback(() => {
        setShowSummary(true);
    }, []);

    return (
        <>
            <motion.div
                className="relative flex w-full flex-col items-center"
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.3}
                onDragEnd={handleDragEnd}
                style={{ touchAction: "pan-y" }}
            >
                <AnimatePresence mode="wait">
                    {mode === "voice" ? (
                        <motion.div
                            key="voice"
                            className="w-full"
                            initial={{ x: -100, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: -100, opacity: 0 }}
                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        >
                            <div
                                data-orb-center
                                className="relative flex flex-col items-center justify-center gap-0 py-4"
                            >
                                <ParticleOrb
                                    state={orbState}
                                    audioLevel={audioLevel}
                                    particleCount={orbParticles}
                                    onClick={handleOrbClick}
                                />

                                {/* Tap hint — fades out after 4s */}
                                <AnimatePresence>
                                    {showHint && orbState === "idle" && (
                                        <motion.div
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            transition={{ duration: 0.8 }}
                                            className="pointer-events-none absolute inset-0 flex items-center justify-center"
                                        >
                                            <motion.span
                                                animate={{ opacity: [0.5, 1, 0.5] }}
                                                transition={{ duration: 2.5, repeat: Infinity }}
                                                className="bg-gradient-to-br from-violet-400 to-violet-600 bg-clip-text text-sm font-medium tracking-wider text-transparent drop-shadow-[0_0_8px_rgba(139,92,246,0.4)]"
                                            >
                                                Нажми на шар
                                            </motion.span>
                                        </motion.div>
                                    )}
                                </AnimatePresence>

                                <span className="-mt-5 text-xs tracking-wide text-zinc-500">
                                    {STATE_LABELS[orbState]}
                                </span>
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="lavalier"
                            className="w-full"
                            initial={{ x: 100, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: 100, opacity: 0 }}
                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        >
                            <LavalierOrb onEndMeeting={handleEndMeeting} />
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Mode indicator dots */}
                <div className="mt-1 flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setMode("voice")}
                        className={`size-1.5 rounded-full transition-all ${mode === "voice"
                            ? "scale-125 bg-violet-500"
                            : "bg-zinc-600 hover:bg-zinc-500"
                            }`}
                        aria-label="Voice mode"
                    />
                    <button
                        type="button"
                        onClick={() => setMode("lavalier")}
                        className={`size-1.5 rounded-full transition-all ${mode === "lavalier"
                            ? "scale-125 bg-violet-500"
                            : "bg-zinc-600 hover:bg-zinc-500"
                            }`}
                        aria-label="Lavalier mode"
                    />
                </div>
            </motion.div>

            {/* Meeting summary modal */}
            {showSummary && <MeetingSummary />}
        </>
    );
}
