"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useChatStore } from "@/stores/chatStore";
import { useUser } from "@/components/providers/UserProvider";
import { logger } from "@/lib/logger";

interface ArchiveResponse {
    success?: boolean;
    file?: string;
    messages?: number;
    error?: string;
}

export function ArchiveButton() {
    const messages = useChatStore((s) => s.messages);
    const { userId } = useUser();
    const [saving, setSaving] = useState(false);
    const [result, setResult] = useState<string | null>(null);

    if (messages.length < 2) return null;

    const handleArchive = async () => {
        setSaving(true);
        setResult(null);

        try {
            const res = await fetch("/api/obsidian/archive", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: messages.map((m) => ({
                        role: m.role,
                        content: m.content,
                        timestamp: m.timestamp,
                    })),
                    userId,
                }),
            });

            const data = (await res.json()) as ArchiveResponse;

            if (data.success) {
                setResult(`Saved: ${data.file}`);
            } else {
                setResult(`Error: ${data.error ?? "Unknown"}`);
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Error";
            logger.error(`Archive error: ${msg}`);
            setResult(`Error: ${msg}`);
        } finally {
            setSaving(false);
            setTimeout(() => setResult(null), 3000);
        }
    };

    return (
        <div className="relative">
            <motion.button
                type="button"
                onClick={handleArchive}
                disabled={saving}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="flex items-center gap-1.5 rounded-lg bg-zinc-800/60 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-700/60 hover:text-zinc-200 disabled:opacity-50"
                title="Save session to Obsidian"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                </svg>
                {saving ? "..." : "Archive"}
            </motion.button>

            <AnimatePresence>
                {result && (
                    <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="absolute -top-8 left-0 whitespace-nowrap rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300"
                    >
                        {result}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
