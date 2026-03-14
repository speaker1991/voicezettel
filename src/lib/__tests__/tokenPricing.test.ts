import { describe, it, expect, vi } from "vitest";

// Mock logger to avoid side effects in tests
vi.mock("@/lib/logger", () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { calculateCost } from "../tokenPricing";

describe("calculateCost", () => {
    it("calculates GPT-4o text cost correctly", () => {
        // gpt-4o: 1M input at $3/1M + 1M output at $10/1M = $13
        const result = calculateCost("gpt-4o", 1_000_000, 1_000_000);
        expect(result.usd).toBe(13);
        expect(result.tokens).toBe(2_000_000);
    });

    it("calculates DeepSeek cost correctly", () => {
        // 1M in at $0.14/1M + 1M out at $0.28/1M = $0.42
        const result = calculateCost("deepseek-chat", 1_000_000, 1_000_000);
        expect(result.usd).toBe(0.42);
    });

    it("returns zero for Gemini free tier", () => {
        const result = calculateCost("gemini-2.0-flash", 1_000_000, 1_000_000);
        expect(result.usd).toBe(0);
    });

    it("calculates RUB correctly (90 RUB/USD)", () => {
        const result = calculateCost("deepseek-chat", 1_000_000, 0);
        // $0.14 * 90 = 12.6 RUB
        expect(result.rub).toBe(12.6);
    });

    it("handles realtime voice model with audio tokens", () => {
        // gpt-realtime-1.5: audioIn $10/1M, audioOut $20/1M
        const result = calculateCost(
            "gpt-realtime-1.5",
            0, 0,
            1_000_000, // audioIn at $10/1M
            1_000_000, // audioOut at $20/1M
        );
        expect(result.usd).toBe(30);
    });

    it("falls back to gpt-4o pricing for unknown models", () => {
        const result = calculateCost("unknown-model-123", 1_000_000, 1_000_000);
        // gpt-4o: $3/1M in + $10/1M out = $13
        expect(result.usd).toBe(13);
    });

    it("handles zero tokens", () => {
        const result = calculateCost("gpt-4o-mini", 0, 0);
        expect(result.usd).toBe(0);
        expect(result.rub).toBe(0);
        expect(result.tokens).toBe(0);
    });

    it("partial model name matching works", () => {
        // "gpt-realtime-1.5" should match
        const result = calculateCost("gpt-realtime-1.5-latest", 0, 0, 1_000_000, 0);
        expect(result.usd).toBe(10); // audioIn $10/1M
    });
});
