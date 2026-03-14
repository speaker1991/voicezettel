"use client";

import { useSettingsStore } from "@/stores/settingsStore";

export function PromptsSection() {
    const settings = useSettingsStore();

    const textareaClass =
        "w-full resize-none rounded-lg border border-white/10 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30";

    return (
        <>
            <section className="mb-6">
                <h3 className="mb-2 text-sm font-semibold text-zinc-400">
                    Системный промт
                </h3>
                <textarea
                    className={textareaClass}
                    rows={4}
                    value={settings.systemPrompt}
                    onChange={(e) => settings.setSystemPrompt(e.target.value)}
                />
            </section>

            <section className="mb-6">
                <h3 className="mb-2 text-sm font-semibold text-zinc-400">
                    Промпт Zettelkasten
                </h3>
                <textarea
                    className={textareaClass}
                    rows={4}
                    value={settings.zettelkastenPrompt}
                    onChange={(e) => settings.setZettelkastenPrompt(e.target.value)}
                />
            </section>
        </>
    );
}
