"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Search, Trash2, FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUser } from "@/components/providers/UserProvider";
import { logger } from "@/lib/logger";

interface MemoryItem {
    id: string;
    text: string;
    tags: string[];
    createdAt: string;
    relevance?: number;
}

const panelVariants = {
    hidden: { x: "100%", opacity: 0 },
    visible: {
        x: 0,
        opacity: 1,
        transition: { type: "spring" as const, damping: 28, stiffness: 300 },
    },
    exit: {
        x: "100%",
        opacity: 0,
        transition: { duration: 0.25 },
    },
};

const backdropVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
    exit: { opacity: 0 },
};

const TAG_COLORS: Record<string, string> = {
    zettel: "bg-violet-500/20 text-violet-300",
    idea: "bg-amber-500/20 text-amber-300",
    fact: "bg-blue-500/20 text-blue-300",
    task: "bg-emerald-500/20 text-emerald-300",
    persona: "bg-pink-500/20 text-pink-300",
    vault: "bg-zinc-500/20 text-zinc-400",
    chat: "bg-zinc-600/20 text-zinc-400",
};

function getTagClass(tag: string): string {
    return TAG_COLORS[tag] ?? "bg-zinc-700/30 text-zinc-400";
}

export function NotesPanel({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const { userId } = useUser();
    const [memories, setMemories] = useState<MemoryItem[]>([]);
    const [total, setTotal] = useState(0);
    const [searchQuery, setSearchQuery] = useState("");
    const [loading, setLoading] = useState(false);

    const fetchMemories = useCallback(async (query?: string) => {
        if (!userId) return;
        setLoading(true);
        try {
            const params = new URLSearchParams({ userId });
            if (query && query.trim()) {
                params.set("q", query.trim());
            } else {
                params.set("recent", "100");
            }
            const res = await fetch(`/api/memories?${params.toString()}`);
            if (!res.ok) return;
            const data = await res.json() as { memories: MemoryItem[]; total?: number };
            setMemories(data.memories);
            if (data.total !== undefined) setTotal(data.total);
        } catch (err) {
            logger.error("Failed to fetch memories:", err instanceof Error ? err.message : "");
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        if (open) {
            void fetchMemories();
        }
    }, [open, fetchMemories]);

    const handleSearch = useCallback(() => {
        void fetchMemories(searchQuery);
    }, [fetchMemories, searchQuery]);

    const handleDelete = useCallback(async (id: string) => {
        if (!userId) return;
        try {
            const res = await fetch(`/api/memories?userId=${userId}&id=${id}`, { method: "DELETE" });
            if (res.ok) {
                setMemories((prev) => prev.filter((m) => m.id !== id));
                setTotal((prev) => Math.max(0, prev - 1));
            }
        } catch {
            // silent
        }
    }, [userId]);

    const handleExport = useCallback(async () => {
        if (memories.length === 0) return;

        const lines = memories.map((m) => {
            const date = new Date(m.createdAt).toLocaleDateString("ru-RU");
            const tags = m.tags.length > 0 ? ` [${m.tags.join(", ")}]` : "";
            return `## ${date}${tags}\n\n${m.text}\n\n---\n`;
        });

        const blob = new Blob([`# VoiceZettel — Экспорт заметок\n\n${lines.join("\n")}`], {
            type: "text/markdown",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `voicezettel-notes-${new Date().toISOString().slice(0, 10)}.md`;
        a.click();
        URL.revokeObjectURL(url);
    }, [memories]);

    const formatDate = (iso: string) => {
        const d = new Date(iso);
        return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
    };

    return (
        <AnimatePresence>
            {open && (
                <>
                    <motion.div
                        key="notes-backdrop"
                        className="fixed inset-0 z-40 bg-black/60"
                        variants={backdropVariants}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                        onClick={onClose}
                    />

                    <motion.div
                        key="notes-panel"
                        className="fixed inset-y-0 right-0 z-50 flex max-w-[420px] w-full flex-col bg-zinc-900 shadow-2xl"
                        variants={panelVariants}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
                            <div className="flex items-center gap-2">
                                <FileText className="size-5 text-violet-400" />
                                <h2 className="text-lg font-bold text-zinc-100">Мои заметки</h2>
                                {total > 0 && (
                                    <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-xs font-medium text-violet-300">
                                        {total}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-1">
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    className="text-zinc-400 hover:text-zinc-100"
                                    onClick={handleExport}
                                    aria-label="Экспорт"
                                    title="Экспорт в Markdown"
                                >
                                    <Download className="size-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    className="text-zinc-400 hover:text-zinc-100"
                                    onClick={onClose}
                                    aria-label="Закрыть"
                                >
                                    <X className="size-5" />
                                </Button>
                            </div>
                        </div>

                        {/* Search */}
                        <div className="border-b border-zinc-800 px-5 py-3">
                            <div className="flex items-center gap-2">
                                <div className="relative flex-1">
                                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                                    <input
                                        type="text"
                                        className="w-full rounded-lg border border-white/10 bg-zinc-800 py-2 pl-9 pr-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                                        placeholder="Семантический поиск…"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                                    />
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-xs text-violet-400 hover:text-violet-300"
                                    onClick={handleSearch}
                                >
                                    Найти
                                </Button>
                            </div>
                        </div>

                        {/* List */}
                        <div className="flex-1 overflow-y-auto px-5 py-3 scrollbar-none">
                            {loading && (
                                <div className="flex items-center justify-center py-8">
                                    <div className="size-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
                                </div>
                            )}
                            {!loading && memories.length === 0 && (
                                <div className="flex flex-col items-center gap-2 py-12 text-center">
                                    <FileText className="size-8 text-zinc-600" />
                                    <p className="text-sm text-zinc-500">
                                        {searchQuery ? "Ничего не найдено" : "Пока нет заметок"}
                                    </p>
                                </div>
                            )}
                            {!loading && memories.map((m) => (
                                <motion.div
                                    key={m.id}
                                    initial={{ opacity: 0, y: 4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="group mb-2 rounded-xl border border-white/5 bg-zinc-800/50 px-4 py-3 transition-colors hover:border-violet-500/20"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <p className="flex-1 text-sm leading-relaxed text-zinc-300">
                                            {m.text.length > 200 ? m.text.slice(0, 200) + "…" : m.text}
                                        </p>
                                        <button
                                            className="mt-0.5 shrink-0 rounded p-1 text-zinc-600 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                                            onClick={() => void handleDelete(m.id)}
                                            aria-label="Удалить"
                                        >
                                            <Trash2 className="size-3.5" />
                                        </button>
                                    </div>
                                    <div className="mt-2 flex items-center gap-2">
                                        <span className="text-[10px] text-zinc-600">{formatDate(m.createdAt)}</span>
                                        {m.relevance !== undefined && (
                                            <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-400">
                                                {m.relevance}%
                                            </span>
                                        )}
                                        {m.tags.slice(0, 4).map((tag) => (
                                            <span
                                                key={tag}
                                                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${getTagClass(tag)}`}
                                            >
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
