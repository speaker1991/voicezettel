"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Copy, Bot, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { useSettingsStore } from "@/stores/settingsStore";
import { useNotificationStore } from "@/stores/notificationStore";

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

function SettingRow({
    label,
    checked,
    onToggle,
}: {
    label: string;
    checked: boolean;
    onToggle: () => void;
}) {
    return (
        <div className="flex items-center justify-between py-2">
            <span className="text-sm text-zinc-300">{label}</span>
            <Switch checked={checked} onCheckedChange={onToggle} />
        </div>
    );
}

export function SettingsPanel({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const settings = useSettingsStore();
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
        navigator.clipboard.writeText(text).catch(() => {
            /* noop */
        });
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
                            choices?: Array<{
                                delta?: { content?: string };
                            }>;
                        };
                        const content =
                            parsed.choices?.[0]?.delta?.content;
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
                            <h2 className="text-lg font-bold text-zinc-100">
                                Настройки
                            </h2>
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

                        {/* ── Widget visibility ─────────────── */}
                        <section className="mb-6">
                            <h3 className="mb-2 text-sm font-semibold text-zinc-400">
                                Показывать виджеты
                            </h3>
                            <div className="divide-y divide-white/5">
                                <SettingRow
                                    label="Токены ($)"
                                    checked={settings.showUsdTokens}
                                    onToggle={settings.toggleShowUsdTokens}
                                />
                                <SettingRow
                                    label="Токены (₽)"
                                    checked={settings.showRubTokens}
                                    onToggle={settings.toggleShowRubTokens}
                                />
                                <SettingRow
                                    label="Баланс токенов"
                                    checked={settings.showTokenBalance}
                                    onToggle={settings.toggleShowTokenBalance}
                                />
                                <SettingRow
                                    label="Счётчик идей"
                                    checked={settings.showIdeasCounter}
                                    onToggle={settings.toggleShowIdeasCounter}
                                />
                                <SettingRow
                                    label="Счётчик фактов"
                                    checked={settings.showFactsCounter}
                                    onToggle={settings.toggleShowFactsCounter}
                                />
                                <SettingRow
                                    label="Счётчик персон"
                                    checked={settings.showPersonsCounter}
                                    onToggle={
                                        settings.toggleShowPersonsCounter
                                    }
                                />
                                <SettingRow
                                    label="Счётчик задач"
                                    checked={settings.showTasksCounter}
                                    onToggle={settings.toggleShowTasksCounter}
                                />
                            </div>
                        </section>

                        {/* ── AI settings ─────────────────────── */}
                        <section className="mb-6">
                            <h3 className="mb-2 text-sm font-semibold text-zinc-400">
                                Настройки ИИ
                            </h3>
                            <div className="divide-y divide-white/5">
                                <div className="flex items-center justify-between py-2">
                                    <span className="text-sm text-zinc-300">
                                        Провайдер
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <button
                                            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${settings.aiProvider ===
                                                "openai"
                                                ? "bg-violet-600 text-white"
                                                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                                                }`}
                                            onClick={() =>
                                                settings.setAiProvider(
                                                    "openai",
                                                )
                                            }
                                        >
                                            OpenAI
                                        </button>
                                        <button
                                            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${settings.aiProvider ===
                                                "deepseek"
                                                ? "bg-violet-600 text-white"
                                                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                                                }`}
                                            onClick={() =>
                                                settings.setAiProvider(
                                                    "deepseek",
                                                )
                                            }
                                        >
                                            DeepSeek
                                        </button>
                                        <button
                                            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${settings.aiProvider ===
                                                "google"
                                                ? "bg-violet-600 text-white"
                                                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                                                }`}
                                            onClick={() =>
                                                settings.setAiProvider(
                                                    "google",
                                                )
                                            }
                                        >
                                            Gemini
                                        </button>
                                    </div>
                                </div>
                                <SettingRow
                                    label="Голос ИИ"
                                    checked={settings.aiVoiceEnabled}
                                    onToggle={settings.toggleAiVoiceEnabled}
                                />
                                {settings.aiVoiceEnabled && (
                                    <div className="flex items-center justify-between py-2">
                                        <span className="text-sm text-zinc-300">
                                            TTS движок
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <button
                                                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${settings.ttsProvider ===
                                                    "browser"
                                                    ? "bg-violet-600 text-white"
                                                    : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                                                    }`}
                                                onClick={() =>
                                                    settings.setTtsProvider(
                                                        "browser",
                                                    )
                                                }
                                            >
                                                Браузер
                                            </button>
                                            <button
                                                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${settings.ttsProvider ===
                                                    "edge"
                                                    ? "bg-violet-600 text-white"
                                                    : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                                                    }`}
                                                onClick={() =>
                                                    settings.setTtsProvider(
                                                        "edge",
                                                    )
                                                }
                                            >
                                                Edge TTS
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </section>

                        {/* ── Orb particles ─────────────────── */}
                        <section className="mb-6">
                            <h3 className="mb-1 text-sm font-semibold text-zinc-400">
                                Частицы сферы
                            </h3>
                            <p className="mb-3 text-xs text-zinc-500">
                                Количество частиц (10-5000). Изменение
                                применится только после перезагрузки
                            </p>
                            <div className="flex items-center gap-4">
                                <Slider
                                    className="flex-1"
                                    min={10}
                                    max={5000}
                                    step={10}
                                    value={[settings.orbParticles]}
                                    onValueChange={(v: number[]) =>
                                        settings.setOrbParticles(v[0])
                                    }
                                />
                                <span className="min-w-[3rem] text-right text-sm font-medium text-zinc-200">
                                    {settings.orbParticles}
                                </span>
                            </div>
                        </section>

                        {/* ── System Prompt ─────────────────── */}
                        <section className="mb-6">
                            <h3 className="mb-2 text-sm font-semibold text-zinc-400">
                                Системный промт
                            </h3>
                            <textarea
                                className="w-full resize-none rounded-lg border border-white/10 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                                rows={4}
                                value={settings.systemPrompt}
                                onChange={(e) =>
                                    settings.setSystemPrompt(e.target.value)
                                }
                            />
                        </section>

                        {/* ── Zettelkasten Prompt ──────────── */}
                        <section className="mb-6">
                            <h3 className="mb-2 text-sm font-semibold text-zinc-400">
                                Промпт Zettelkasten
                            </h3>
                            <textarea
                                className="w-full resize-none rounded-lg border border-white/10 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                                rows={4}
                                value={settings.zettelkastenPrompt}
                                onChange={(e) =>
                                    settings.setZettelkastenPrompt(
                                        e.target.value,
                                    )
                                }
                            />
                        </section>

                        {/* ── Obsidian Zettelkasten ──────────── */}
                        <section className="mb-6">
                            <h3 className="mb-2 text-sm font-semibold text-zinc-400">
                                📓 Obsidian Zettelkasten
                            </h3>
                            <p className="mb-3 text-xs text-zinc-500">
                                Заметки создаются автоматически после
                                каждого ответа ИИ. Для работы нужен
                                плагин{" "}
                                <a
                                    href="https://github.com/coddingtonbear/obsidian-local-rest-api"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-violet-400 underline"
                                >
                                    Local REST API
                                </a>
                                .
                            </p>
                            <div className="space-y-3">
                                <div>
                                    <label className="mb-1 block text-xs text-zinc-500">
                                        API ключ
                                    </label>
                                    <input
                                        type="password"
                                        className="w-full rounded-lg border border-white/10 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                                        placeholder="Вставьте ключ из плагина"
                                        value={settings.obsidianApiKey}
                                        onChange={(e) =>
                                            settings.setObsidianApiKey(
                                                e.target.value,
                                            )
                                        }
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs text-zinc-500">
                                        URL сервера
                                    </label>
                                    <input
                                        type="text"
                                        className="w-full rounded-lg border border-white/10 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                                        value={settings.obsidianApiUrl}
                                        onChange={(e) =>
                                            settings.setObsidianApiUrl(
                                                e.target.value,
                                            )
                                        }
                                    />
                                </div>
                                {settings.obsidianApiKey ? (
                                    <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                                        <span className="size-1.5 rounded-full bg-emerald-400" />
                                        Ключ установлен — заметки
                                        создаются мгновенно
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                                        <span className="size-1.5 rounded-full bg-zinc-600" />
                                        Вставьте API ключ для
                                        активации
                                    </div>
                                )}
                            </div>
                        </section>

                        {/* ── Logs ──────────────────────────── */}
                        <section>
                            <div className="mb-2 flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-zinc-400">
                                    Консоль логов
                                </h3>
                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="ghost"
                                        size="xs"
                                        className="text-xs text-zinc-500 hover:text-zinc-300"
                                        onClick={handleCopyLogs}
                                    >
                                        <Copy className="mr-1 size-3" />
                                        Копировать
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="xs"
                                        className="text-xs text-violet-400 hover:text-violet-300"
                                        onClick={handleAiAnalyze}
                                        disabled={aiLogLoading}
                                    >
                                        {aiLogLoading ? (
                                            <Loader2 className="mr-1 size-3 animate-spin" />
                                        ) : (
                                            <Bot className="mr-1 size-3" />
                                        )}
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

                            {/* AI analysis response */}
                            <AnimatePresence>
                                {aiLogResponse && (
                                    <motion.div
                                        initial={{
                                            opacity: 0,
                                            height: 0,
                                        }}
                                        animate={{
                                            opacity: 1,
                                            height: "auto",
                                        }}
                                        exit={{ opacity: 0, height: 0 }}
                                        className="mt-2 overflow-hidden rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2.5"
                                    >
                                        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-400">
                                            <Bot className="size-3" />
                                            Анализ ИИ
                                        </div>
                                        <p className="text-xs leading-relaxed text-zinc-300">
                                            {aiLogResponse}
                                        </p>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </section>

                        {/* Admin panel link */}
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
