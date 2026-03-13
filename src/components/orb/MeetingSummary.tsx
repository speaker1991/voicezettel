"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, Copy, Check, BookmarkPlus } from "lucide-react";
import { useLavalierStore } from "@/stores/lavalierStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { sendToObsidian } from "@/lib/obsidianClient";
import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "@/lib/logger";

export function MeetingSummary() {
    const transcript = useLavalierStore((s) => s.transcript);
    const meetingStartedAt = useLavalierStore((s) => s.meetingStartedAt);
    const summary = useLavalierStore((s) => s.summary);
    const isGenerating = useLavalierStore((s) => s.isGeneratingSummary);
    const setSummary = useLavalierStore((s) => s.setSummary);
    const setIsGenerating = useLavalierStore((s) => s.setIsGeneratingSummary);
    const clear = useLavalierStore((s) => s.clear);

    const [visible, setVisible] = useState(false);
    const [copied, setCopied] = useState(false);
    const [savedToObsidian, setSavedToObsidian] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    // Show modal when we have transcript but no summary yet
    useEffect(() => {
        if (transcript.length > 0 && !summary && !isGenerating) {
            setVisible(true);
            generateSummary();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const generateSummary = useCallback(async () => {
        if (transcript.length === 0) return;

        setIsGenerating(true);
        abortRef.current = new AbortController();

        try {
            const res = await fetch("/api/meeting-summary", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    transcript: transcript.map((t) => ({
                        text: t.text,
                        timestamp: t.timestamp,
                    })),
                    meetingStartedAt: meetingStartedAt ?? new Date().toISOString(),
                }),
                signal: abortRef.current.signal,
            });

            if (!res.ok || !res.body) {
                throw new Error(`Summary API error: ${res.status}`);
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let accumulated = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split("\n");

                for (const line of lines) {
                    if (!line.startsWith("data: ")) continue;
                    const data = line.slice(6);
                    if (data === "[DONE]") break;

                    try {
                        const parsed = JSON.parse(data) as {
                            choices: Array<{
                                delta: { content?: string };
                            }>;
                        };
                        const content = parsed.choices[0]?.delta?.content;
                        if (content) {
                            accumulated += content;
                            setSummary(accumulated);
                        }
                    } catch {
                        // Skip unparseable SSE chunks
                    }
                }
            }
        } catch (err) {
            if (err instanceof Error && err.name !== "AbortError") {
                logger.error("Summary generation failed:", err.message);
                setSummary("❌ Не удалось сгенерировать саммари");
            }
        } finally {
            setIsGenerating(false);
        }
    }, [transcript, meetingStartedAt, setSummary, setIsGenerating]);

    const handleCopy = useCallback(async () => {
        if (!summary) return;
        await navigator.clipboard.writeText(summary);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [summary]);

    const handleSaveToObsidian = useCallback(async () => {
        if (!summary) return;
        try {
            const now = new Date();
            const dateStr = now.toISOString().split("T")[0];
            const title = `Протокол встречи ${dateStr}`;
            const content = `---\ntype: meeting\ntags: ["meeting", "protocol"]\ncreated: ${now.toISOString()}\n---\n\n${summary}`;

            await sendToObsidian(
                `Встреча ${dateStr} (${transcript.length} реплик)`,
                content,
            );
            setSavedToObsidian(true);
            useNotificationStore
                .getState()
                .addNotification("📓 Протокол сохранён в Obsidian", "info");
        } catch (err) {
            logger.error("Failed to save to Obsidian:", err);
            useNotificationStore
                .getState()
                .addNotification("Ошибка сохранения в Obsidian", "error");
        }
    }, [summary, transcript.length]);

    const handleClose = useCallback(() => {
        abortRef.current?.abort();
        setVisible(false);
        // Delay clear to allow exit animation
        setTimeout(() => clear(), 300);
    }, [clear]);

    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
                >
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.9, opacity: 0, y: 20 }}
                        className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
                            <h2 className="text-sm font-medium text-zinc-100">
                                📋 Протокол встречи
                            </h2>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={handleSaveToObsidian}
                                    disabled={!summary || isGenerating || savedToObsidian}
                                    className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200 disabled:opacity-30"
                                    title="Сохранить в Obsidian"
                                >
                                    {savedToObsidian ? (
                                        <Check className="size-4 text-emerald-400" />
                                    ) : (
                                        <BookmarkPlus className="size-4" />
                                    )}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleCopy}
                                    disabled={!summary || isGenerating}
                                    className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200 disabled:opacity-30"
                                >
                                    {copied ? (
                                        <Check className="size-4 text-emerald-400" />
                                    ) : (
                                        <Copy className="size-4" />
                                    )}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleClose}
                                    className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200"
                                >
                                    <X className="size-4" />
                                </button>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="max-h-[65vh] overflow-y-auto p-5">
                            {isGenerating && !summary && (
                                <div className="flex flex-col items-center gap-2 py-8">
                                    <div className="size-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
                                    <span className="text-xs text-zinc-500">
                                        Генерирую протокол…
                                    </span>
                                </div>
                            )}

                            {summary && (
                                <div className="prose prose-invert prose-sm max-w-none text-zinc-300">
                                    {summary.split("\n").map((line, i) => (
                                        <p key={i} className="my-1">
                                            {line}
                                        </p>
                                    ))}
                                </div>
                            )}

                            {isGenerating && summary && (
                                <div className="mt-2 flex items-center gap-1.5">
                                    <div className="size-1.5 animate-pulse rounded-full bg-violet-500" />
                                    <span className="text-[10px] text-zinc-500">
                                        генерирую…
                                    </span>
                                </div>
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
