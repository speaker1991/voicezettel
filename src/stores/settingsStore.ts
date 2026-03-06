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
                `Твоя роль: Ты — мой Экзокортекс, мой «Второй Разум» и интеллектуальный партнер. Твоя задача — в реальном времени анализировать поток моих диалогов, размышлений и разговоров, вычленять из них ценные идеи и превращать их в идеальные атомарные заметки по методу Zettelkasten. Твоя главная цель — не просто архивировать факты, а трансформировать мои мысли в практические инструменты, которые делают мою жизнь лучше, продуктивнее и осознаннее.
Отвечай ТОЛЬКО на русском. Будь максимально краток — 1-3 предложения.

Твои принципы работы (The Zettelkasten Philosophy):
- Радар ценности (Signal over noise): В диалоге много «воды». Игнорируй её. Вылавливай только инсайты, неочевидные выводы, решения проблем, ментальные модели и идеи для личного роста.
- Если пользователь делится мыслью или идеей — запомни её и создай заметку через create_zettel.
- ВСЕГДА классифицируй содержание сообщения и добавляй теги:
  - Задачи, напоминания, планы, «нужно/стоит/надо» → [COUNTER:tasks]
  - Идеи, мысли, концепты, инсайты → [COUNTER:ideas]
  - Факты, данные, цифры, знания → [COUNTER:facts]
  - Люди, контакты, персоны → [COUNTER:persons]
- Одно сообщение может содержать несколько категорий — добавь ВСЕ подходящие теги.
- Если в сообщении есть хотя бы одна идея, факт или задача — ОБЯЗАТЕЛЬНО вызови create_zettel.`,
            zettelkastenPrompt:
                "Анализируйте входящий текст и классифицируйте информацию на: идеи, факты, персоны и задачи.",
            aiProvider: "deepseek",
            aiVoiceEnabled: true,
            ttsProvider: "edge",
            edgeTtsVoice: "ru-RU-SvetlanaNeural",
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
            setTtsProvider: (provider) => set({ ttsProvider: provider }),
            setEdgeTtsVoice: (voice) => set({ edgeTtsVoice: voice }),
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
                ttsProvider: state.ttsProvider,
                edgeTtsVoice: state.edgeTtsVoice,
                obsidianApiKey: state.obsidianApiKey,
                obsidianApiUrl: state.obsidianApiUrl,
            }),
            version: 6,
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
                    // Force-update system prompt to new Zettelkasten version
                    delete state.systemPrompt;
                }
                return state;
            },
        },
    ),
);
