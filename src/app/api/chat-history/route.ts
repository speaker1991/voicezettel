import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { z } from "zod";
import { logger } from "@/lib/logger";

const DATA_DIR = join(process.cwd(), "data");

const MessageSchema = z.object({
    id: z.string(),
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    timestamp: z.string(),
    source: z.enum(["text", "voice"]).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});

const SaveRequestSchema = z.object({
    userId: z.string(),
    messages: z.array(MessageSchema),
});

const LoadRequestSchema = z.object({
    userId: z.string(),
});

function getChatPath(userId: string): string {
    const safe = userId.replace(/[^a-zA-Z0-9@._-]/g, "_");
    return join(DATA_DIR, `chat_${safe}.json`);
}

// ── GET: Load chat history ───────────────────────────────────
export async function POST(req: NextRequest) {
    const raw: unknown = await req.json();
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (action === "load") {
        const parsed = LoadRequestSchema.safeParse(raw);
        if (!parsed.success) {
            return NextResponse.json(
                { error: "Invalid request" },
                { status: 400 },
            );
        }

        const chatPath = getChatPath(parsed.data.userId);

        try {
            const content = await readFile(chatPath, "utf-8");
            const messages = JSON.parse(content) as unknown[];
            return NextResponse.json({ messages });
        } catch {
            // No history yet
            return NextResponse.json({ messages: [] });
        }
    }

    // ── SAVE: Persist chat history ───────────────────────────
    const parsed = SaveRequestSchema.safeParse(raw);
    if (!parsed.success) {
        return NextResponse.json(
            { error: "Invalid request", details: parsed.error.flatten() },
            { status: 400 },
        );
    }

    const { userId, messages } = parsed.data;
    const chatPath = getChatPath(userId);

    try {
        await mkdir(dirname(chatPath), { recursive: true });
        // Keep last 200 messages max to limit file size
        const trimmed = messages.slice(-200);
        await writeFile(chatPath, JSON.stringify(trimmed), "utf-8");
        logger.debug(`Chat saved [${userId}]: ${trimmed.length} messages`);
        return NextResponse.json({ success: true, count: trimmed.length });
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown";
        logger.error(`Chat save error [${userId}]: ${msg}`);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
