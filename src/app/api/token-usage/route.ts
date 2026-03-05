import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { calculateCost } from "@/lib/tokenPricing";
import { logger } from "@/lib/logger";
import type {
    TokenUsageData,
    TokenUsageRequest,
    TokenUsageResponse,
} from "@/types/tokenUsage";

const DATA_DIR = join(process.cwd(), "data");

function filePath(userId: string): string {
    const safe = userId.replace(/[^a-zA-Z0-9@._-]/g, "_");
    return join(DATA_DIR, `tokens_${safe}.json`);
}

async function loadUsage(userId: string): Promise<TokenUsageData> {
    try {
        const raw = await readFile(filePath(userId), "utf-8");
        return JSON.parse(raw) as TokenUsageData;
    } catch {
        return { version: 1, totalTokens: 0, totalCostUsd: 0, totalCostRub: 0, entries: [] };
    }
}

async function saveUsage(userId: string, data: TokenUsageData): Promise<void> {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(filePath(userId), JSON.stringify(data), "utf-8");
}

// ── GET: Load current token usage ───────────────────────────
export async function GET(req: NextRequest): Promise<NextResponse<TokenUsageResponse>> {
    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) {
        return NextResponse.json(
            { totalTokens: 0, totalCostUsd: 0, totalCostRub: 0 },
        );
    }

    const data = await loadUsage(userId);
    return NextResponse.json({
        totalTokens: data.totalTokens,
        totalCostUsd: data.totalCostUsd,
        totalCostRub: data.totalCostRub,
    });
}

// ── POST: Record new token usage ────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse<TokenUsageResponse>> {
    const body = (await req.json()) as TokenUsageRequest;
    const { userId, model, textIn, textOut, audioIn = 0, audioOut = 0 } = body;

    if (!userId || !model) {
        return NextResponse.json(
            { totalTokens: 0, totalCostUsd: 0, totalCostRub: 0 },
            { status: 400 },
        );
    }

    const cost = calculateCost(model, textIn, textOut, audioIn, audioOut);

    const data = await loadUsage(userId);

    // Add entry (keep last 500 entries to avoid unbounded growth)
    data.entries.push({
        model,
        textIn,
        textOut,
        audioIn,
        audioOut,
        costUsd: cost.usd,
        timestamp: new Date().toISOString(),
    });
    if (data.entries.length > 500) {
        data.entries = data.entries.slice(-500);
    }

    data.totalTokens += cost.tokens;
    data.totalCostUsd = Math.round((data.totalCostUsd + cost.usd) * 1_000_000) / 1_000_000;
    data.totalCostRub = Math.round((data.totalCostRub + cost.rub) * 10_000) / 10_000;

    await saveUsage(userId, data);

    logger.debug(
        `Token usage [${userId}]: +${cost.tokens} tokens, +$${cost.usd.toFixed(6)} (${model})`,
    );

    return NextResponse.json({
        totalTokens: data.totalTokens,
        totalCostUsd: data.totalCostUsd,
        totalCostRub: data.totalCostRub,
    });
}
