import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SettingsState, SettingsActions } from "@/types/counters";

export const useSettingsStore = create<SettingsState & SettingsActions>()(
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
            obsidianApiKey: "",
            obsidianApiUrl: "http://127.0.0.1:27123",

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
            setObsidianApiKey: (key) => set({ obsidianApiKey: key }),
            setObsidianApiUrl: (url) => set({ obsidianApiUrl: url }),
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
                obsidianApiKey: state.obsidianApiKey,
                obsidianApiUrl: state.obsidianApiUrl,
            }),
        },
    ),
);
