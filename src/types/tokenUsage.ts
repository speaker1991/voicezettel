// ── Token usage types ───────────────────────────────────────

export interface TokenUsageEntry {
    model: string;
    textIn: number;
    textOut: number;
    audioIn: number;
    audioOut: number;
    costUsd: number;
    timestamp: string;
}

export interface TokenUsageData {
    version: 1;
    totalTokens: number;
    totalCostUsd: number;
    totalCostRub: number;
    entries: TokenUsageEntry[];
}

/** Request body for POST /api/token-usage */
export interface TokenUsageRequest {
    userId: string;
    model: string;
    textIn: number;
    textOut: number;
    audioIn?: number;
    audioOut?: number;
}

/** Response from GET/POST /api/token-usage */
export interface TokenUsageResponse {
    totalTokens: number;
    totalCostUsd: number;
    totalCostRub: number;
}
