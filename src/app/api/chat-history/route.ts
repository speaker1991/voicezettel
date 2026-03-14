/**
 * @module api/chat-history
 * Load and save chat message history via SQLite.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";

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

// ── POST: Load or save chat history ──
export async function POST(req: NextRequest) {
    const raw: unknown = await req.json();
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (action === "load") {
        const parsed = LoadRequestSchema.safeParse(raw);
        if (!parsed.success) {
            return NextResponse.json({ error: "Invalid request" }, { status: 400 });
        }

        const db = getDb();
        const rows = db.prepare(
            `SELECT id, role, content, source, metadata, timestamp
             FROM chat_messages WHERE user_id = ?
             ORDER BY timestamp ASC LIMIT 200`,
        ).all(parsed.data.userId) as Array<{
            id: string;
            role: string;
            content: string;
            source: string | null;
            metadata: string | null;
            timestamp: string;
        }>;

        const messages = rows.map((r) => ({
            id: r.id,
            role: r.role,
            content: r.content,
            timestamp: r.timestamp,
            source: r.source ?? undefined,
            metadata: r.metadata ? JSON.parse(r.metadata) as Record<string, unknown> : undefined,
        }));

        return NextResponse.json({ messages });
    }

    // ── SAVE ──
    const parsed = SaveRequestSchema.safeParse(raw);
    if (!parsed.success) {
        return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }

    const { userId, messages } = parsed.data;
    const trimmed = messages.slice(-200);

    try {
        const db = getDb();
        const tx = db.transaction(() => {
            db.prepare(`DELETE FROM chat_messages WHERE user_id = ?`).run(userId);
            const insert = db.prepare(
                `INSERT INTO chat_messages (id, user_id, role, content, source, metadata, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
            );
            for (const m of trimmed) {
                insert.run(
                    m.id,
                    userId,
                    m.role,
                    m.content,
                    m.source ?? null,
                    m.metadata ? JSON.stringify(m.metadata) : null,
                    m.timestamp,
                );
            }
        });
        tx();

        logger.debug(`Chat saved [${userId}]: ${trimmed.length} messages`);
        return NextResponse.json({ success: true, count: trimmed.length });
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown";
        logger.error(`Chat save error [${userId}]: ${msg}`);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
