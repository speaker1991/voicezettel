/**
 * @module api/settings
 * User settings storage via SQLite.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";

const SaveSchema = z.object({
    userId: z.string().min(1),
    settings: z.record(z.string(), z.unknown()),
});

/**
 * GET /api/settings?userId=xxx
 * Load user's settings from SQLite.
 */
export async function GET(req: NextRequest) {
    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) {
        return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    const db = getDb();
    const row = db.prepare(
        `SELECT data FROM settings WHERE user_id = ?`,
    ).get(userId) as { data: string } | undefined;

    if (!row) {
        return NextResponse.json({ settings: null });
    }

    return NextResponse.json({ settings: JSON.parse(row.data) as Record<string, unknown> });
}

/**
 * POST /api/settings
 * Save user's settings to SQLite.
 */
export async function POST(req: NextRequest) {
    const raw: unknown = await req.json();
    const parsed = SaveSchema.safeParse(raw);

    if (!parsed.success) {
        return NextResponse.json({ error: "Invalid" }, { status: 400 });
    }

    const { userId, settings } = parsed.data;

    try {
        const db = getDb();
        db.prepare(
            `INSERT INTO settings (user_id, data) VALUES (?, ?)
             ON CONFLICT(user_id) DO UPDATE SET data = excluded.data`,
        ).run(userId, JSON.stringify(settings, null, 2));

        return NextResponse.json({ ok: true });
    } catch (err) {
        logger.error("Settings save error:", (err as Error).message);
        return NextResponse.json({ error: "Save failed" }, { status: 500 });
    }
}
