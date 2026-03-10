import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";

const DATA_DIR = path.join(process.cwd(), "data", "settings");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CONDENSE_THRESHOLD = 5;

const AddPrefSchema = z.object({
    userId: z.string(),
    rule: z.string().min(1).max(500),
});

interface SettingsFile {
    behaviorRules?: string[];
    condensedProfile?: string;
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

/**
 * Condense multiple rules into a compact user profile via GPT-4o-mini.
 */
async function condenseRules(rules: string[]): Promise<string | null> {
    if (!OPENAI_API_KEY || rules.length < CONDENSE_THRESHOLD) return null;

    try {
        const rulesList = rules.map((r, i) => `${i + 1}. ${r}`).join("\n");
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                max_tokens: 300,
                temperature: 0.3,
                messages: [
                    {
                        role: "system",
                        content: "Ты — утилита сжатия правил. Получив список правил поведения ассистента, объедини их в ОДИН компактный абзац (макс 3-4 предложения). Сохрани ВСЕ требования без потери смысла. Ответ — только сжатый текст, без вступлений.",
                    },
                    {
                        role: "user",
                        content: `Сожми эти правила в компактный профиль:\n${rulesList}`,
                    },
                ],
            }),
        });

        if (!res.ok) return null;

        const data = (await res.json()) as {
            choices: { message: { content: string } }[];
        };
        const condensed = data.choices?.[0]?.message?.content?.trim();
        return condensed || null;
    } catch {
        return null;
    }
}

const MAX_RULES = 50;

// POST — add a behavior rule, auto-condense when threshold exceeded
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

        // Auto-condense when threshold exceeded
        let condensed = false;
        if (settings.behaviorRules.length >= CONDENSE_THRESHOLD) {
            const profile = await condenseRules(settings.behaviorRules);
            if (profile) {
                settings.condensedProfile = profile;
                condensed = true;
            }
        }

        await writeSettings(userId, settings);

        return NextResponse.json({
            ok: true,
            totalRules: settings.behaviorRules.length,
            condensed,
            profile: settings.condensedProfile ?? null,
        });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Unknown error" },
            { status: 500 },
        );
    }
}

// GET — read behavior rules (returns condensed profile if available)
export async function GET(req: NextRequest): Promise<NextResponse> {
    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) {
        return NextResponse.json({ error: "userId required" }, { status: 400 });
    }

    const settings = await readSettings(userId);
    return NextResponse.json({
        rules: settings.behaviorRules ?? [],
        profile: settings.condensedProfile ?? null,
    });
}
