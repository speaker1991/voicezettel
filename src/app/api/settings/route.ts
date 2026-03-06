import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { z } from "zod";
import { logger } from "@/lib/logger";

const DATA_DIR = join(process.cwd(), "data", "settings");

const SaveSchema = z.object({
    userId: z.string().min(1),
    settings: z.record(z.string(), z.unknown()),
});

/**
 * GET /api/settings?userId=xxx
 * Load user's settings from server.
 */
export async function GET(req: NextRequest) {
    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) {
        return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    try {
        const filePath = join(DATA_DIR, `${sanitize(userId)}.json`);
        const raw = await readFile(filePath, "utf-8");
        const settings = JSON.parse(raw) as Record<string, unknown>;
        return NextResponse.json({ settings });
    } catch {
        // No saved settings — return empty
        return NextResponse.json({ settings: null });
    }
}

/**
 * POST /api/settings
 * Save user's settings to server.
 */
export async function POST(req: NextRequest) {
    const raw: unknown = await req.json();
    const parsed = SaveSchema.safeParse(raw);

    if (!parsed.success) {
        return NextResponse.json({ error: "Invalid" }, { status: 400 });
    }

    const { userId, settings } = parsed.data;

    try {
        await mkdir(DATA_DIR, { recursive: true });
        const filePath = join(DATA_DIR, `${sanitize(userId)}.json`);
        await writeFile(filePath, JSON.stringify(settings, null, 2), "utf-8");
        return NextResponse.json({ ok: true });
    } catch (err) {
        logger.error("Settings save error:", (err as Error).message);
        return NextResponse.json({ error: "Save failed" }, { status: 500 });
    }
}

/** Sanitize userId for filesystem safety */
function sanitize(userId: string): string {
    return userId.replace(/[^a-zA-Z0-9@._-]/g, "_").slice(0, 100);
}
