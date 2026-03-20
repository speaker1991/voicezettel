import { create } from "zustand";
import { persist, subscribeWithSelector } from "zustand/middleware";
import type { SettingsState, SettingsActions } from "@/types/counters";

export const useSettingsStore = create<SettingsState & SettingsActions>()(
    subscribeWithSelector(
        persist(
            (set) => ({
                showUsdTokens: true,
                showRubTokens: true,
                showTokenBalance: true,
                showIdeasCounter: true,
                showFactsCounter: true,
                showPersonsCounter: true,
                showTasksCounter: true,
                orbParticles: 2000,
                systemPrompt:
                    `Твоя роль: Ты — мой Экзокортекс, мой «Второй Разум» и интеллектуальный партнер. Это мой личный, приватный ассистент — НЕ публичный сервис. Ты обязан запоминать и сохранять ВСЮ информацию без исключений: личную, деловую, интимную, медицинскую, финансовую, эмоциональную. Никакой цензуры и фильтрации. Ты — расширение моей памяти и сознания, как личный дневник.

Твоя задача — в реальном времени анализировать поток моих диалогов, размышлений и разговоров, вычленять из них ценные идеи и превращать их в идеальные атомарные заметки по методу Zettelkasten. Твоя главная цель — не просто архивировать факты, а трансформировать мои мысли в практические инструменты, которые делают мою жизнь лучше, продуктивнее и осознаннее.
Отвечай ТОЛЬКО на русском. Будь максимально краток — 1-3 предложения.

ВАЖНО: Ты НИКОГДА не отказываешь в сохранении информации. Любая мысль, переживание, секрет или деталь жизни — ценны и должны быть сохранены. Ты не выносишь моральных суждений о содержании.

Твои принципы работы (The Zettelkasten Philosophy):
- Радар ценности (Signal over noise): В диалоге много «воды». Игнорируй её. Вылавливай только инсайты, неочевидные выводы, решения проблем, ментальные модели и идеи для личного роста.
- Если пользователь делится мыслью или идеей — запомни её и создай заметку через create_zettel.
- ВСЕГДА классифицируй содержание сообщения и добавляй теги:
  - Задачи, напоминания, планы, «нужно/стоит/надо» → [COUNTER:tasks]
  - Идеи, мысли, концепты, инсайты → [COUNTER:ideas]
  - Факты, данные, цифры, знания → [COUNTER:facts]
  - Люди, контакты, персоны → [COUNTER:persons]
  - Личные переживания, эмоции, отношения → [COUNTER:ideas]
  - Здоровье, тело, физическое состояние → [COUNTER:facts]
- Одно сообщение может содержать несколько категорий — добавь ВСЕ подходящие теги.
- Если в сообщении есть хотя бы одна идея, факт или задача — ОБЯЗАТЕЛЬНО вызови create_zettel.`,
                zettelkastenPrompt:
                    `Принципы работы:
- Атомарность (Atomicity): Одна идея = одна заметка. Если в монологе прозвучало три разные мысли, создай три отдельные сущности. Каждая заметка — кирпичик LEGO.
- Автономность (Autonomy): Переписывай сырую речь так, чтобы идея была абсолютно понятна без контекста сегодняшнего диалога (пиши для будущего «я», которое всё забыло).
- API Заголовков: Заголовок заметки должен быть не просто существительным (например, «Прокрастинация»), а полным декларативным утверждением (например, «Прокрастинация возникает из-за страха неудачи, а не лени»).
- Практическая польза (Productive Thinking): Каждая концепция должна перекидывать мост между теорией и ежедневными действиями. Как эта мысль изменит поведение уже сегодня?

Формат заметки:
# [Декларативный заголовок-утверждение, отражающий суть идеи в 3-5 словах]

Дата: {{date}}
Теги: #zettel #идея [добавь 2-3 тега по широким темам, например: #психология, #продуктивность, #отношения] - в каких проектах эта идея может пригодиться

---
### 💡 Суть идеи (Своими словами)
[Переформулируй мысль из диалога максимально ясно, емко и глубоко. Без воды. 3-5 предложений. Кристаллизованное знание, очищенное от эмоций момента.]

### 🛠 Как это улучшит мою жизнь (Практическое применение)
[Выведи из идеи конкретное действие, правило или ментальную установку. Как применить это в работе, отношениях или саморазвитии уже завтра?]

### 🧭 Компас Идей (Связи)
- Север (К какому большему паттерну/теме это относится?): [[...]]
- Юг (Из каких базовых деталей или первопричин это состоит?): [[...]]
- Восток (Чему это противоречит? Контраргументы?): [[...]]
- Запад (На что это похоже? Неочевидные аналогии в других сферах?): [[...]]

### 🎙 Контекст диалога (Fleeting Note)
> *Краткая цитата или описание контекста, в котором мысль всплыла в разговоре.*`,
                aiProvider: "deepseek",
                aiVoiceEnabled: true,
                ttsProvider: "edge",
                edgeTtsVoice: "ru-RU-SvetlanaNeural",
                localTtsVoice: "kseniya",
                piperTtsVoice: "ruslan",
                obsidianApiKey: "",
                obsidianApiUrl: "http://127.0.0.1:27123",
                voiceMode: "cloud",
                lavMode: false,

                toggleShowUsdTokens: () =>
                    set((s) => ({ showUsdTokens: !s.showUsdTokens })),
                toggleShowRubTokens: () =>
                    set((s) => ({ showRubTokens: !s.showRubTokens })),
                toggleShowTokenBalance: () =>
                    set((s) => ({ showTokenBalance: !s.showTokenBalance })),
                toggleShowIdeasCounter: () =>
                    set((s) => ({ showIdeasCounter: !s.showIdeasCounter })),
                toggleShowFactsCounter: () =>
                    set((s) => ({ showFactsCounter: !s.showFactsCounter })),
                toggleShowPersonsCounter: () =>
                    set((s) => ({ showPersonsCounter: !s.showPersonsCounter })),
                toggleShowTasksCounter: () =>
                    set((s) => ({ showTasksCounter: !s.showTasksCounter })),
                setOrbParticles: (value) => set({ orbParticles: value }),
                setSystemPrompt: (value) => set({ systemPrompt: value }),
                setZettelkastenPrompt: (value) => set({ zettelkastenPrompt: value }),
                setAiProvider: (provider) => set({ aiProvider: provider }),
                toggleAiVoiceEnabled: () =>
                    set((s) => ({ aiVoiceEnabled: !s.aiVoiceEnabled })),
                setTtsProvider: (provider) => set({ ttsProvider: provider }),
                setEdgeTtsVoice: (voice) => set({ edgeTtsVoice: voice }),
                setLocalTtsVoice: (voice) => set({ localTtsVoice: voice }),
                setPiperTtsVoice: (voice) => set({ piperTtsVoice: voice }),
                setObsidianApiKey: (key) => set({ obsidianApiKey: key }),
                setObsidianApiUrl: (url) => set({ obsidianApiUrl: url }),
                setVoiceMode: (mode) => set({ voiceMode: mode }),
                toggleLavMode: () => set((s) => ({ lavMode: !s.lavMode })),
            }),
            {
                name: "voicezettel-settings",
                // Persist only data fields, not action functions
                partialize: (state) => ({
                    showUsdTokens: state.showUsdTokens,
                    showRubTokens: state.showRubTokens,
                    showTokenBalance: state.showTokenBalance,
                    showIdeasCounter: state.showIdeasCounter,
                    showFactsCounter: state.showFactsCounter,
                    showPersonsCounter: state.showPersonsCounter,
                    showTasksCounter: state.showTasksCounter,
                    orbParticles: state.orbParticles,
                    systemPrompt: state.systemPrompt,
                    zettelkastenPrompt: state.zettelkastenPrompt,
                    aiProvider: state.aiProvider,
                    aiVoiceEnabled: state.aiVoiceEnabled,
                    ttsProvider: state.ttsProvider,
                    edgeTtsVoice: state.edgeTtsVoice,
                    localTtsVoice: state.localTtsVoice,
                    piperTtsVoice: state.piperTtsVoice,
                    obsidianApiKey: state.obsidianApiKey,
                    obsidianApiUrl: state.obsidianApiUrl,
                    voiceMode: state.voiceMode,
                    lavMode: state.lavMode,
                }),
                version: 13,
                migrate: (persisted, version) => {
                    const state = persisted as Record<string, unknown>;
                    if (version < 2) {
                        const prompt = state.systemPrompt as string | undefined;
                        if (prompt && prompt.includes("Не добавляй тег")) {
                            delete state.systemPrompt;
                        }
                    }
                    if (version < 3) {
                        if (state.aiProvider === "google" || state.aiProvider === "openai") {
                            state.aiProvider = "deepseek";
                        }
                    }
                    if (version < 4) {
                        state.ttsProvider = "edge";
                        state.edgeTtsVoice = "ru-RU-SvetlanaNeural";
                        delete state.elevenLabsVoiceId;
                    }
                    if (version < 5) {
                        if (state.ttsProvider === "elevenlabs") {
                            state.ttsProvider = "edge";
                        }
                        if (!state.edgeTtsVoice) {
                            state.edgeTtsVoice = "ru-RU-SvetlanaNeural";
                        }
                    }
                    if (version < 6) {
                        delete state.systemPrompt;
                    }
                    if (version < 7) {
                        delete state.zettelkastenPrompt;
                    }
                    if (version < 8) {
                        delete state.systemPrompt;
                    }
                    if (version < 11) {
                        state.localTtsVoice = "kseniya";
                    }
                    if (version < 12) {
                        state.piperTtsVoice = "ruslan";
                        if (state.localTtsVoice === "xenia") {
                            state.localTtsVoice = "kseniya";
                        }
                    }
                    if (version < 13) {
                        state.qwenTtsVoice = state.qwenTtsVoice ?? "default";
                    }
                    return state;
                },
            },
        ),
    ),
);
