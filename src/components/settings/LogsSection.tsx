"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Bot, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/stores/settingsStore";
import { useNotificationStore } from "@/stores/notificationStore";

export function LogsSection() {
    const notifications = useNotificationStore((s) => s.notifications);
    const [aiLogResponse, setAiLogResponse] = useState<string | null>(null);
    const [aiLogLoading, setAiLogLoading] = useState(false);

    const getLogLines = useCallback(() => {
        if (notifications.length === 0) {
            return [
                "[INFO] VoiceZettel инициализирован",
                "[INFO] Система готова к работе",
            ];
        }
        return notifications.map(
            (n) =>
                `[${n.level.toUpperCase()}] ${new Date(n.timestamp).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} ${n.message}`,
        );
    }, [notifications]);

    const handleCopyLogs = useCallback(() => {
        const text = getLogLines().join("\n");
        navigator.clipboard.writeText(text).catch(() => { /* noop */ });
    }, [getLogLines]);

    const handleAiAnalyze = useCallback(async () => {
        setAiLogLoading(true);
        setAiLogResponse(null);

        const logText = getLogLines().join("\n");

        try {
            const res = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: [
                        {
                            role: "user",
                            content: `Проанализируй эти логи приложения VoiceZettel и скажи коротко (1-3 предложения): есть ли проблемы? Если всё хорошо — напиши что всё ок.\n\nЛоги:\n${logText}`,
                        },
                    ],
                    provider: useSettingsStore.getState().aiProvider,
                    systemPrompt:
                        "Ты — DevOps-помощник. Анализируй логи кратко, на русском. Не добавляй тег [COUNTER].",
                }),
            });

            if (!res.ok || !res.body) {
                setAiLogResponse("⚠️ Не удалось получить ответ от ИИ");
                return;
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
                    const data = line.slice(6).trim();
                    if (data === "[DONE]") continue;

                    try {
                        const parsed = JSON.parse(data) as {
                            choices?: Array<{ delta?: { content?: string } }>;
                        };
                        const content = parsed.choices?.[0]?.delta?.content;
                        if (content) {
                            accumulated += content;
                            setAiLogResponse(accumulated);
                        }
                    } catch {
                        // skip
                    }
                }
            }
        } catch {
            setAiLogResponse("⚠️ Ошибка при анализе логов");
        } finally {
            setAiLogLoading(false);
        }
    }, [getLogLines]);

    return (
        <section>
            <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-400">Консоль логов</h3>
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="xs" className="text-xs text-zinc-500 hover:text-zinc-300" onClick={handleCopyLogs}>
                        <Copy className="mr-1 size-3" />
                        Копировать
                    </Button>
                    <Button variant="ghost" size="xs" className="text-xs text-violet-400 hover:text-violet-300" onClick={handleAiAnalyze} disabled={aiLogLoading}>
                        {aiLogLoading ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Bot className="mr-1 size-3" />}
                        Анализ ИИ
                    </Button>
                </div>
            </div>
            <div className="max-h-40 overflow-y-auto rounded-lg bg-zinc-800 px-3 py-3 font-mono text-xs leading-relaxed text-zinc-400 scrollbar-none">
                {getLogLines().map((line, i) => (
                    <div
                        key={`log-${i}`}
                        className={
                            line.includes("[ERROR]")
                                ? "text-red-400"
                                : line.includes("[WARNING]")
                                    ? "text-amber-400"
                                    : ""
                        }
                    >
                        {line}
                    </div>
                ))}
            </div>

            <AnimatePresence>
                {aiLogResponse && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-2 overflow-hidden rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2.5"
                    >
                        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-400">
                            <Bot className="size-3" />
                            Анализ ИИ
                        </div>
                        <p className="text-xs leading-relaxed text-zinc-300">{aiLogResponse}</p>
                    </motion.div>
                )}
            </AnimatePresence>
        </section>
    );
}
