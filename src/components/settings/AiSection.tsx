"use client";

import { useSettingsStore } from "@/stores/settingsStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { Switch } from "@/components/ui/switch";

const PROVIDERS = [
    { key: "openai" as const, label: "OpenAI", notif: "Мозги: OpenAI — применится к следующему сообщению" },
    { key: "deepseek" as const, label: "DeepSeek", notif: "Мозги: DeepSeek — применится к следующему сообщению" },
    { key: "google" as const, label: "Gemini", notif: "Мозги: Gemini — применится к следующему сообщению" },
];

const TTS_PROVIDERS = [
    { key: "openai" as const, label: "OpenAI", notif: "Озвучка: OpenAI — перезапустите сессию" },
    { key: "browser" as const, label: "Браузер", notif: "Озвучка: Браузер — применится к следующему ответу" },
    { key: "edge" as const, label: "Edge TTS", notif: "TTS: Edge TTS — применится к следующему ответу" },
    { key: "yandex" as const, label: "Yandex", notif: "TTS: Yandex SpeechKit — применится к следующему ответу" },
    { key: "local" as const, label: "Local", notif: "TTS: Silero Local — применится к следующему ответу" },
];

function ProviderButton({
    active,
    label,
    onClick,
}: {
    active: boolean;
    label: string;
    onClick: () => void;
}) {
    return (
        <button
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${active
                ? "bg-violet-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
            onClick={onClick}
        >
            {label}
        </button>
    );
}

export function AiSection() {
    const settings = useSettingsStore();
    const addNotification = useNotificationStore((s) => s.addNotification);

    return (
        <section className="mb-6">
            <h3 className="mb-2 text-sm font-semibold text-zinc-400">
                Настройки ИИ
            </h3>
            <div className="divide-y divide-white/5">
                {/* AI Provider */}
                <div className="flex items-center justify-between py-2">
                    <span className="text-sm text-zinc-300">Мозги</span>
                    <div className="flex items-center gap-2">
                        {PROVIDERS.map((p) => (
                            <ProviderButton
                                key={p.key}
                                active={settings.aiProvider === p.key}
                                label={p.label}
                                onClick={() => {
                                    settings.setAiProvider(p.key);
                                    addNotification(p.notif, "info");
                                }}
                            />
                        ))}
                    </div>
                </div>

                {/* Voice toggle */}
                <div className="flex items-center justify-between py-2">
                    <span className="text-sm text-zinc-300">Голос ИИ</span>
                    <Switch checked={settings.aiVoiceEnabled} onCheckedChange={settings.toggleAiVoiceEnabled} />
                </div>

                {/* TTS Provider (shown when voice enabled) */}
                {settings.aiVoiceEnabled && (
                    <div className="flex items-center justify-between py-2">
                        <span className="text-sm text-zinc-300">Озвучка</span>
                        <div className="flex items-center gap-2">
                            {TTS_PROVIDERS.map((p) => (
                                <ProviderButton
                                    key={p.key}
                                    active={settings.ttsProvider === p.key}
                                    label={p.label}
                                    onClick={() => {
                                        settings.setTtsProvider(p.key);
                                        addNotification(p.notif, "info");
                                    }}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
