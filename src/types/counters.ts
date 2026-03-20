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
    /** Load persisted token totals from server */
    loadTokensFromServer: (userId: string) => Promise<void>;
    /** Report usage to server and update local state */
    reportTokenUsage: (userId: string, model: string, textIn: number, textOut: number, audioIn?: number, audioOut?: number) => Promise<void>;
}

// ── Settings store types ────────────────────────────────────
export type AiProvider = "openai" | "google" | "deepseek";
export type TtsProvider = "browser" | "edge" | "yandex" | "openai" | "local" | "piper" | "qwen";
export type VoiceMode = "cloud" | "local" | "browser" | "yandex";

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
    ttsProvider: TtsProvider;
    edgeTtsVoice: string;
    localTtsVoice: string;
    piperTtsVoice: string;
    obsidianApiKey: string;
    obsidianApiUrl: string;
    voiceMode: VoiceMode;
    lavMode: boolean;
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
    setTtsProvider: (provider: TtsProvider) => void;
    setEdgeTtsVoice: (voice: string) => void;
    setLocalTtsVoice: (voice: string) => void;
    setPiperTtsVoice: (voice: string) => void;
    setObsidianApiKey: (key: string) => void;
    setObsidianApiUrl: (url: string) => void;
    setVoiceMode: (mode: VoiceMode) => void;
    toggleLavMode: () => void;
}
