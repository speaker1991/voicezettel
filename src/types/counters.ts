// ── Counter store types ─────────────────────────────────────
export interface CountersState {
    ideas: number;
    facts: number;
    persons: number;
    tasks: number;
    tokensUsd: number;
    tokensRub: number;
    tokensBalance: number;
}

export interface CountersActions {
    incrementIdeas: () => void;
    incrementFacts: () => void;
    incrementPersons: () => void;
    incrementTasks: () => void;
    setTokensUsd: (value: number) => void;
    setTokensRub: (value: number) => void;
    setTokensBalance: (value: number) => void;
    addTokensUsed: (count: number) => void;
}

// ── Settings store types ────────────────────────────────────
export type AiProvider = "openai" | "google";

export interface SettingsState {
    showUsdTokens: boolean;
    showRubTokens: boolean;
    showTokenBalance: boolean;
    showIdeasCounter: boolean;
    showFactsCounter: boolean;
    showPersonsCounter: boolean;
    showTasksCounter: boolean;
    orbParticles: number;
    systemPrompt: string;
    zettelkastenPrompt: string;
    aiProvider: AiProvider;
    aiVoiceEnabled: boolean;
    obsidianApiKey: string;
    obsidianApiUrl: string;
}

export interface SettingsActions {
    toggleShowUsdTokens: () => void;
    toggleShowRubTokens: () => void;
    toggleShowTokenBalance: () => void;
    toggleShowIdeasCounter: () => void;
    toggleShowFactsCounter: () => void;
    toggleShowPersonsCounter: () => void;
    toggleShowTasksCounter: () => void;
    setOrbParticles: (value: number) => void;
    setSystemPrompt: (value: string) => void;
    setZettelkastenPrompt: (value: string) => void;
    setAiProvider: (provider: AiProvider) => void;
    toggleAiVoiceEnabled: () => void;
    setObsidianApiKey: (key: string) => void;
    setObsidianApiUrl: (url: string) => void;
}
