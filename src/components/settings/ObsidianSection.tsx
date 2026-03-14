"use client";

import { useSettingsStore } from "@/stores/settingsStore";

export function ObsidianSection() {
    const settings = useSettingsStore();

    const inputClass =
        "w-full rounded-lg border border-white/10 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30";

    return (
        <section className="mb-6">
            <h3 className="mb-2 text-sm font-semibold text-zinc-400">
                📓 Obsidian Zettelkasten
            </h3>
            <p className="mb-3 text-xs text-zinc-500">
                Заметки создаются автоматически после каждого ответа ИИ. Для работы нужен плагин{" "}
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
                    <label className="mb-1 block text-xs text-zinc-500">API ключ</label>
                    <input
                        type="password"
                        className={inputClass}
                        placeholder="Вставьте ключ из плагина"
                        value={settings.obsidianApiKey}
                        onChange={(e) => settings.setObsidianApiKey(e.target.value)}
                    />
                </div>
                <div>
                    <label className="mb-1 block text-xs text-zinc-500">URL сервера</label>
                    <input
                        type="text"
                        className={inputClass}
                        value={settings.obsidianApiUrl}
                        onChange={(e) => settings.setObsidianApiUrl(e.target.value)}
                    />
                </div>
                {settings.obsidianApiKey ? (
                    <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                        <span className="size-1.5 rounded-full bg-emerald-400" />
                        Ключ установлен — заметки создаются мгновенно
                    </div>
                ) : (
                    <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                        <span className="size-1.5 rounded-full bg-zinc-600" />
                        Вставьте API ключ для активации
                    </div>
                )}
            </div>
        </section>
    );
}
