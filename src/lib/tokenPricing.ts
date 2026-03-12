import { logger } from "@/lib/logger";

// ── Pricing per 1M tokens (USD) ─────────────────────────────
interface ModelPricing {
    textIn: number;
    textOut: number;
    audioIn: number;
    audioOut: number;
}

const PRICING: Record<string, ModelPricing> = {
    // GPT-4o (text chat)
    "gpt-4o": { textIn: 3.0, textOut: 10.0, audioIn: 0, audioOut: 0 },
    "gpt-4o-mini": { textIn: 0.15, textOut: 0.6, audioIn: 0, audioOut: 0 },
    // Realtime voice
    "gpt-4o-realtime-preview": {
        textIn: 4.0,
        textOut: 16.0,
        audioIn: 32.0,
        audioOut: 64.0,
    },
    "gpt-4o-mini-realtime-preview": {
        textIn: 0.6,
        textOut: 2.4,
        audioIn: 10.0,
        audioOut: 20.0,
    },
    "gpt-realtime-1.5": {
        textIn: 0.6,
        textOut: 2.4,
        audioIn: 10.0,
        audioOut: 20.0,
    },
    // DeepSeek V3 (works without VPN)
    "deepseek-chat": { textIn: 0.14, textOut: 0.28, audioIn: 0, audioOut: 0 },
    // Gemini free tier
    "gemini-2.0-flash": { textIn: 0, textOut: 0, audioIn: 0, audioOut: 0 },
};

const RUB_PER_USD = 90;

export interface CostResult {
    usd: number;
    rub: number;
    tokens: number;
}

/**
 * Calculate cost for a given model and token counts.
 */
export function calculateCost(
    model: string,
    textIn: number,
    textOut: number,
    audioIn: number = 0,
    audioOut: number = 0,
): CostResult {
    // Find matching pricing (partial match)
    let pricing: ModelPricing | undefined;
    for (const [key, p] of Object.entries(PRICING)) {
        if (model.includes(key)) {
            pricing = p;
            break;
        }
    }

    if (!pricing) {
        // Default to gpt-4o pricing
        logger.warn(`Unknown model "${model}", using gpt-4o pricing`);
        pricing = PRICING["gpt-4o"];
    }

    const usd =
        (textIn / 1_000_000) * pricing.textIn +
        (textOut / 1_000_000) * pricing.textOut +
        (audioIn / 1_000_000) * pricing.audioIn +
        (audioOut / 1_000_000) * pricing.audioOut;

    const totalTokens = textIn + textOut + audioIn + audioOut;

    return {
        usd: Math.round(usd * 1_000_000) / 1_000_000, // 6 decimal precision
        rub: Math.round(usd * RUB_PER_USD * 10_000) / 10_000,
        tokens: totalTokens,
    };
}
