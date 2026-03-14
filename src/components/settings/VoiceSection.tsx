"use client";

import { useSettingsStore } from "@/stores/settingsStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { Slider } from "@/components/ui/slider";

export function VoiceSection() {
    const settings = useSettingsStore();
    const addNotification = useNotificationStore((s) => s.addNotification);

    return (
        <>
            {/* STT Provider */}
            <section className="mb-6">
                <h3 className="mb-3 text-sm font-semibold text-zinc-400">
                    STT движок
                </h3>
                <div className="flex gap-2">
                    {([
                        { value: "local" as const, label: "🖥 Local Core", desc: "GPU (faster-whisper)" },
                        { value: "yandex" as const, label: "☁️ Yandex STT", desc: "Облако" },
                    ] as const).map((opt) => (
                        <button
                            key={opt.value}
                            className={`flex-1 rounded-lg border px-3 py-2 text-left transition-colors ${
                                settings.voiceMode === opt.value
                                    ? "border-violet-500/50 bg-violet-500/10 text-violet-300"
                                    : "border-white/5 bg-zinc-800/50 text-zinc-400 hover:text-zinc-200"
                            }`}
                            onClick={() => settings.setVoiceMode(opt.value)}
                        >
                            <span className="block text-xs font-medium">{opt.label}</span>
                            <span className="block text-[10px] text-zinc-500">{opt.desc}</span>
                        </button>
                    ))}
                </div>
            </section>

            {/* Voice Mode — Lavalier */}
            <section className="mb-6">
                <h3 className="mb-3 text-sm font-semibold text-zinc-400">
                    Голосовой движок
                </h3>
                <div className="divide-y divide-white/5">
                    <div className="flex items-center justify-between py-2">
                        <div className="flex flex-col">
                            <span className="text-sm text-zinc-300">🎙 Петличка</span>
                            <span className="text-xs text-zinc-500">Фоновая запись встречи</span>
                        </div>
                        <button
                            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${settings.lavMode
                                ? "bg-emerald-600 text-white"
                                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                            }`}
                            onClick={() => {
                                settings.toggleLavMode();
                                const newState = !settings.lavMode;
                                addNotification(
                                    newState
                                        ? "Петличка включена — запись началась"
                                        : "Петличка выключена — генерируется конспект",
                                    "info",
                                );
                            }}
                        >
                            {settings.lavMode ? "⏹ Выкл" : "▶ Вкл"}
                        </button>
                    </div>
                </div>
            </section>

            {/* Orb Particles */}
            <section className="mb-6">
                <h3 className="mb-1 text-sm font-semibold text-zinc-400">
                    Частицы сферы
                </h3>
                <p className="mb-3 text-xs text-zinc-500">
                    Количество частиц (10-5000). Изменение применится только после перезагрузки
                </p>
                <div className="flex items-center gap-4">
                    <Slider
                        className="flex-1"
                        min={10}
                        max={5000}
                        step={10}
                        value={[settings.orbParticles]}
                        onValueChange={(v: number[]) => settings.setOrbParticles(v[0])}
                    />
                    <span className="min-w-[3rem] text-right text-sm font-medium text-zinc-200">
                        {settings.orbParticles}
                    </span>
                </div>
            </section>
        </>
    );
}
