"use client";

import { useState } from "react";

const DEFAULT_PROMPT = `Ты — помощник VoiceZettel. Отвечай ТОЛЬКО на русском. Будь максимально краток — 1-2 предложения. Не повторяй вопрос пользователя.

Если пользователь просит создать/записать/запомнить что-то, определи категорию и добавь тег:
- Задачи → [COUNTER:tasks]
- Идеи → [COUNTER:ideas]
- Факты → [COUNTER:facts]
- Люди → [COUNTER:persons]

Не добавляй тег если пользователь просто разговаривает.`;

const VARIABLES = [
    { name: "{{user_name}}", desc: "Имя пользователя" },
    { name: "{{language}}", desc: "Язык ответа" },
    { name: "{{max_tokens}}", desc: "Лимит токенов" },
    { name: "{{context}}", desc: "Контекст из хранилища" },
    { name: "{{timestamp}}", desc: "Текущая дата/время" },
];

export function PromptsTab() {
    const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
    const [saved, setSaved] = useState(false);

    const handleSave = () => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    return (
        <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
            {/* Editor */}
            <div className="rounded-2xl border border-violet-500/15 bg-zinc-900/60 p-4 backdrop-blur-md">
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                        Системный промпт
                    </h3>
                    <button
                        type="button"
                        onClick={handleSave}
                        className={`rounded-lg border px-3 py-1 text-xs font-medium transition-all ${saved
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                                : "border-violet-500/30 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20"
                            }`}
                    >
                        {saved ? "✓ Сохранено" : "Сохранить"}
                    </button>
                </div>
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="h-[340px] w-full resize-none rounded-xl border border-white/[0.04] bg-black/30 p-3.5 font-mono text-xs leading-relaxed text-zinc-300 outline-none transition-colors placeholder:text-zinc-600 focus:border-violet-500/25"
                />
                <div className="mt-2 text-right text-[10px] text-zinc-600">
                    {prompt.length} символов
                </div>
            </div>

            {/* Variables sidebar */}
            <div className="rounded-2xl border border-violet-500/15 bg-zinc-900/60 p-4 backdrop-blur-md">
                <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Переменные
                </h3>
                <div className="space-y-2">
                    {VARIABLES.map((v) => (
                        <div
                            key={v.name}
                            className="rounded-lg border border-white/[0.04] bg-black/20 px-3 py-2"
                        >
                            <code className="text-[11px] font-semibold text-violet-400">
                                {v.name}
                            </code>
                            <div className="mt-0.5 text-[10px] text-zinc-600">
                                {v.desc}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="mt-4 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
                    <div className="text-[10px] font-semibold uppercase text-cyan-500/70">
                        Подсказка
                    </div>
                    <div className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                        Вставляйте переменные в текст промпта — они будут
                        заменены реальными значениями при каждой сессии.
                    </div>
                </div>
            </div>
        </div>
    );
}
