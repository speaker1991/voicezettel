"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Particle {
    id: number;
    x: number;
    y: number;
    angle: number;
    distance: number;
    size: number;
    delay: number;
}

interface ParticleBurstProps {
    x: number;
    y: number;
    onComplete: () => void;
}

const PARTICLE_COUNT = 10;

function generateParticles(): Particle[] {
    return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
        id: i,
        x: 0,
        y: 0,
        angle: (360 / PARTICLE_COUNT) * i + (Math.random() - 0.5) * 30,
        distance: 20 + Math.random() * 30,
        size: 2 + Math.random() * 3,
        delay: Math.random() * 0.05,
    }));
}

export function ParticleBurst({ x, y, onComplete }: ParticleBurstProps) {
    const [particles] = useState(generateParticles);
    const [completedCount, setCompletedCount] = useState(0);

    const handleComplete = useCallback(() => {
        setCompletedCount((prev) => {
            const next = prev + 1;
            if (next >= PARTICLE_COUNT) {
                onComplete();
            }
            return next;
        });
    }, [onComplete]);

    return (
        <AnimatePresence>
            {particles.map((p) => {
                const rad = (p.angle * Math.PI) / 180;
                const tx = Math.cos(rad) * p.distance;
                const ty = Math.sin(rad) * p.distance;

                return (
                    <motion.div
                        key={p.id}
                        initial={{
                            x: x - p.size / 2,
                            y: y - p.size / 2,
                            scale: 1,
                            opacity: 1,
                        }}
                        animate={{
                            x: x + tx,
                            y: y + ty,
                            scale: 0,
                            opacity: 0,
                        }}
                        transition={{
                            duration: 0.5,
                            delay: p.delay,
                            ease: "easeOut",
                        }}
                        onAnimationComplete={
                            completedCount < PARTICLE_COUNT
                                ? handleComplete
                                : undefined
                        }
                        style={{
                            position: "fixed",
                            width: p.size,
                            height: p.size,
                            borderRadius: "50%",
                            pointerEvents: "none",
                        }}
                        className="bg-violet-400 shadow-[0_0_6px_rgba(139,92,246,0.8)]"
                    />
                );
            })}
        </AnimatePresence>
    );
}
