import { create } from "zustand";
import type { SettingsState, SettingsActions } from "@/types/counters";

export const useSettingsStore = create<SettingsState & SettingsActions>()(
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
            `Ты — помощник VoiceZettel. Отвечай ТОЛЬКО на русском. Будь максимально краток — 1-2 предложения.

Если пользователь просит создать/записать/запомнить что-то, определи категорию и добавь тег в конец ответа:
- Задачи, заметки, напоминания, дела → [COUNTER:tasks]
- Идеи, мысли, предложения, концепты → [COUNTER:ideas]
- Факты, знания, информация, определения → [COUNTER:facts]
- Люди, контакты, персоны, имена → [COUNTER:persons]

Не добавляй тег если пользователь просто разговаривает или задаёт вопрос.`,
        zettelkastenPrompt:
            "Анализируйте входящий текст и классифицируйте информацию на: идеи, факты, персоны и задачи.",
        aiProvider: "openai",
        aiVoiceEnabled: true,

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
    }),
);
