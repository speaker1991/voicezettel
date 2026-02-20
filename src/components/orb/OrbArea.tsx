"use client";

import { motion } from "framer-motion";

export function OrbArea() {
    return (
        <div className="flex items-center justify-center py-8">
            <motion.div
                className="size-24 rounded-full border border-violet-500/20 bg-violet-500/10"
                animate={{
                    boxShadow: [
                        "0 0 0 0px rgba(139,92,246,0.15)",
                        "0 0 0 12px rgba(139,92,246,0)",
                    ],
                }}
                transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeOut",
                }}
            />
        </div>
    );
}
