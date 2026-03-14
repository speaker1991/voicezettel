/**
 * @module api/token-usage
 * Token usage tracking via SQLite.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { calculateCost } from "@/lib/tokenPricing";
import { logger } from "@/lib/logger";
import type { TokenUsageRequest, TokenUsageResponse } from "@/types/tokenUsage";

// ── GET: Load current token usage totals ──
export async function GET(req: NextRequest): Promise<NextResponse<TokenUsageResponse>> {
    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) {
        return NextResponse.json({ totalTokens: 0, totalCostUsd: 0, totalCostRub: 0 });
    }

    const db = getDb();
    const row = db.prepare(
        `SELECT
            COALESCE(SUM(text_in + text_out + audio_in + audio_out), 0) as totalTokens,
            COALESCE(SUM(cost_usd), 0) as totalCostUsd
         FROM token_usage WHERE user_id = ?`,
    ).get(userId) as { totalTokens: number; totalCostUsd: number };

    return NextResponse.json({
        totalTokens: row.totalTokens,
        totalCostUsd: Math.round(row.totalCostUsd * 1_000_000) / 1_000_000,
        totalCostRub: Math.round(row.totalCostUsd * 96 * 10_000) / 10_000,
    });
}

// ── POST: Record new token usage ──
export async function POST(req: NextRequest): Promise<NextResponse<TokenUsageResponse>> {
    const body = (await req.json()) as TokenUsageRequest;
    const { userId, model, textIn, textOut, audioIn = 0, audioOut = 0 } = body;

    if (!userId || !model) {
        return NextResponse.json({ totalTokens: 0, totalCostUsd: 0, totalCostRub: 0 }, { status: 400 });
    }

    const cost = calculateCost(model, textIn, textOut, audioIn, audioOut);
    const db = getDb();

    db.prepare(
        `INSERT INTO token_usage (user_id, model, text_in, text_out, audio_in, audio_out, cost_usd, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(userId, model, textIn, textOut, audioIn, audioOut, cost.usd, new Date().toISOString());

    // Prune old entries (keep last 500)
    db.prepare(
        `DELETE FROM token_usage WHERE user_id = ? AND id NOT IN (
            SELECT id FROM token_usage WHERE user_id = ? ORDER BY timestamp DESC LIMIT 500
        )`,
    ).run(userId, userId);

    logger.debug(`Token usage [${userId}]: +${cost.tokens} tokens, +$${cost.usd.toFixed(6)} (${model})`);

    // Re-calculate totals
    const totals = db.prepare(
        `SELECT
            COALESCE(SUM(text_in + text_out + audio_in + audio_out), 0) as totalTokens,
            COALESCE(SUM(cost_usd), 0) as totalCostUsd
         FROM token_usage WHERE user_id = ?`,
    ).get(userId) as { totalTokens: number; totalCostUsd: number };

    return NextResponse.json({
        totalTokens: totals.totalTokens,
        totalCostUsd: Math.round(totals.totalCostUsd * 1_000_000) / 1_000_000,
        totalCostRub: Math.round(totals.totalCostUsd * 96 * 10_000) / 10_000,
    });
}
