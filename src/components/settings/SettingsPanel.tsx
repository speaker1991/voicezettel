"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

import { WidgetsSection } from "./WidgetsSection";
import { AiSection } from "./AiSection";
import { VoiceSection } from "./VoiceSection";
import { PromptsSection } from "./PromptsSection";
import { ObsidianSection } from "./ObsidianSection";
import { LogsSection } from "./LogsSection";

const panelVariants = {
    hidden: { y: "-100%", opacity: 0 },
    visible: {
        y: 0,
        opacity: 1,
        transition: { type: "spring" as const, damping: 28, stiffness: 300 },
    },
    exit: {
        y: "-100%",
        opacity: 0,
        transition: { duration: 0.25 },
    },
};

const backdropVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
    exit: { opacity: 0 },
};

export function SettingsPanel({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    return (
        <AnimatePresence>
            {open && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        key="settings-backdrop"
                        className="fixed inset-0 z-40 bg-black/60"
                        variants={backdropVariants}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                        onClick={onClose}
                    />

                    {/* Panel */}
                    <motion.div
                        key="settings-panel"
                        className="fixed inset-x-0 top-0 z-50 mx-auto max-h-[90dvh] w-full max-w-[480px] overflow-y-auto rounded-b-2xl bg-zinc-900 px-5 pb-6 pt-4 shadow-2xl"
                        variants={panelVariants}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                    >
                        {/* Header */}
                        <div className="mb-4 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-zinc-100">Настройки</h2>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-zinc-400 hover:text-zinc-100"
                                onClick={onClose}
                                aria-label="Закрыть настройки"
                            >
                                <X className="size-5" />
                            </Button>
                        </div>

                        <WidgetsSection />
                        <AiSection />
                        <VoiceSection />
                        <PromptsSection />
                        <ObsidianSection />
                        <LogsSection />

                        {/* Admin link */}
                        <section className="mt-4 border-t border-zinc-800 pt-4">
                            <Link
                                href="/admin"
                                className="flex w-full items-center justify-center gap-2 rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-2.5 text-sm font-medium text-violet-400 transition-all hover:bg-violet-500/10 hover:shadow-[0_0_12px_rgba(139,92,246,0.15)]"
                            >
                                <ShieldCheck className="size-4" />
                                Админ-панель
                            </Link>
                        </section>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
