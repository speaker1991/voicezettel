"use client";

import { motion } from "framer-motion";
import { ParticleHead } from "@/components/orb/ParticleHead";
import { useSettingsStore } from "@/stores/settingsStore";

export function AgentOrb() {
    const orbParticles = useSettingsStore((s) => s.orbParticles);

    return (
        <div className="flex flex-col items-center justify-center gap-0 py-4">
            <ParticleHead particleCount={Math.round(orbParticles * 0.75)} />
            <motion.span
                className="-mt-5 bg-gradient-to-br from-violet-400 to-violet-600 bg-clip-text text-xs tracking-wide text-transparent"
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 3, repeat: Infinity }}
            >
                Агент в разработке
            </motion.span>
        </div>
    );
}
