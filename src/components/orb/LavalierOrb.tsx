"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Pause, Play, Bot, Square } from "lucide-react";
import { ParticleOrb } from "@/components/orb/ParticleOrb";
import { useLavalierStore } from "@/stores/lavalierStore";
import { useChatStore } from "@/stores/chatStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useLavalierSession } from "@/hooks/useLavalierSession";
import { warmUpAudio } from "@/lib/sounds";
import { useEffect, useState, useCallback } from "react";

function formatElapsed(startedAt: string | null): string {
    if (!startedAt) return "00:00";
    const diff = Date.now() - new Date(startedAt).getTime();
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

interface LavalierOrbProps {
    onEndMeeting: () => void;
}

export function LavalierOrb({ onEndMeeting }: LavalierOrbProps) {
    const lavalierState = useLavalierStore((s) => s.state);
    const meetingStartedAt = useLavalierStore((s) => s.meetingStartedAt);
    const transcriptCount = useLavalierStore((s) => s.transcript.length);
    const orbParticles = useSettingsStore((s) => s.orbParticles);
    const audioLevel = useChatStore((s) => s.audioLevel);

    const {
        isActive,
        startLavalier,
        stopLavalier,
        pauseLavalier,
        resumeLavalier,
    } = useLavalierSession();

    const [elapsed, setElapsed] = useState("00:00");

    // Update timer
    useEffect(() => {
        if (lavalierState !== "listening") return;
        const interval = setInterval(() => {
            setElapsed(formatElapsed(meetingStartedAt));
        }, 1000);
        return () => clearInterval(interval);
    }, [lavalierState, meetingStartedAt]);

    const handleStartStop = useCallback(() => {
        warmUpAudio();
        if (isActive) {
            stopLavalier();
            onEndMeeting();
        } else {
            startLavalier();
        }
    }, [isActive, startLavalier, stopLavalier, onEndMeeting]);

    const handlePauseResume = useCallback(() => {
        if (lavalierState === "paused") {
            resumeLavalier();
        } else {
            pauseLavalier();
        }
    }, [lavalierState, pauseLavalier, resumeLavalier]);

    return (
        <div
            data-orb-center
            className="flex flex-col items-center justify-center gap-0 py-4"
        >
            <ParticleOrb
                state={
                    isActive ? "backgroundListening" : "idle"
                }
                audioLevel={audioLevel}
                particleCount={orbParticles}
                onClick={handleStartStop}
            />

            {/* Status text */}
            <motion.div
                className="-mt-5 flex flex-col items-center gap-1"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
            >
                {isActive ? (
                    <>
                        <span className="text-xs tracking-wide text-violet-400/60">
                            {lavalierState === "paused"
                                ? "На паузе"
                                : "Я слушаю и записываю…"}
                        </span>
                        <div className="flex items-center gap-3 text-[10px] text-zinc-500">
                            <span>⏱ {elapsed}</span>
                            <span>💬 {transcriptCount} реплик</span>
                        </div>
                    </>
                ) : (
                    <span className="text-xs tracking-wide text-zinc-500">
                        Нажми для начала записи
                    </span>
                )}
            </motion.div>

            {/* Control buttons */}
            <AnimatePresence>
                {isActive && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="mt-3 flex items-center gap-3"
                    >
                        {/* Pause / Resume */}
                        <button
                            type="button"
                            onClick={handlePauseResume}
                            className="flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800/80 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-700/80"
                        >
                            {lavalierState === "paused" ? (
                                <>
                                    <Play className="size-3" />
                                    Продолжить
                                </>
                            ) : (
                                <>
                                    <Pause className="size-3" />
                                    Пауза
                                </>
                            )}
                        </button>

                        {/* Ask AI */}
                        <button
                            type="button"
                            className="flex items-center gap-1.5 rounded-full border border-violet-700/50 bg-violet-900/30 px-3 py-1.5 text-xs text-violet-300 transition-colors hover:border-violet-600 hover:bg-violet-800/30"
                        >
                            <Bot className="size-3" />
                            Спросить ИИ
                        </button>

                        {/* End meeting */}
                        <button
                            type="button"
                            onClick={handleStartStop}
                            className="flex items-center gap-1.5 rounded-full border border-red-700/50 bg-red-900/30 px-3 py-1.5 text-xs text-red-300 transition-colors hover:border-red-600 hover:bg-red-800/30"
                        >
                            <Square className="size-3" />
                            Завершить
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
