import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";

const DATA_DIR = path.join(process.cwd(), "data", "settings");

const AddPrefSchema = z.object({
    userId: z.string(),
    rule: z.string().min(1).max(500),
});

interface SettingsFile {
    behaviorRules?: string[];
    [key: string]: unknown;
}

function sanitizeUserId(userId: string): string {
    return userId.replace(/[^a-zA-Z0-9@._-]/g, "_").slice(0, 100);
}

function getSettingsPath(userId: string): string {
    return path.join(DATA_DIR, `${sanitizeUserId(userId)}.json`);
}

async function readSettings(userId: string): Promise<SettingsFile> {
    try {
        const data = await fs.readFile(getSettingsPath(userId), "utf-8");
        return JSON.parse(data) as SettingsFile;
    } catch {
        return {};
    }
}

async function writeSettings(userId: string, settings: SettingsFile): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(getSettingsPath(userId), JSON.stringify(settings, null, 2), "utf-8");
}

const MAX_RULES = 50;

// POST — add a behavior rule
export async function POST(req: NextRequest): Promise<NextResponse> {
    try {
        const body: unknown = await req.json();
        const parsed = AddPrefSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
        }

        const { userId, rule } = parsed.data;
        const settings = await readSettings(userId);
        const rules = settings.behaviorRules ?? [];

        // Avoid duplicates
        if (rules.some((r) => r.toLowerCase() === rule.toLowerCase())) {
            return NextResponse.json({ ok: true, duplicate: true });
        }

        rules.push(rule);
        settings.behaviorRules = rules.slice(-MAX_RULES);
        await writeSettings(userId, settings);

        return NextResponse.json({ ok: true, totalRules: settings.behaviorRules.length });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Unknown error" },
            { status: 500 },
        );
    }
}

// GET — read behavior rules for a user
export async function GET(req: NextRequest): Promise<NextResponse> {
    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) {
        return NextResponse.json({ error: "userId required" }, { status: 400 });
    }

    const settings = await readSettings(userId);
    return NextResponse.json({ rules: settings.behaviorRules ?? [] });
}
