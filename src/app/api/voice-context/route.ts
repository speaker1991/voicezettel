import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
    searchMemories,
    getRecentMemories,
} from "@/lib/memoryStore";

const RequestSchema = z.object({
    userId: z.string().default("anonymous"),
    recentMessages: z
        .array(
            z.object({
                role: z.string(),
                content: z.string(),
            }),
        )
        .default([]),
});

export async function POST(req: NextRequest) {
    const raw: unknown = await req.json();
    const parsed = RequestSchema.safeParse(raw);

    if (!parsed.success) {
        return NextResponse.json({ instructions: "" }, { status: 400 });
    }

    const { userId, recentMessages } = parsed.data;

    const parts: string[] = [];

    // 1. Recent memories
    const recent = await getRecentMemories(userId, 30);
    if (recent.length > 0) {
        parts.push("--- MEMORY (what you remember about this user) ---");
        for (const mem of recent) {
            const date = new Date(mem.createdAt).toLocaleDateString("ru-RU");
            const tags = mem.tags.length > 0 ? ` [${mem.tags.join(", ")}]` : "";
            parts.push(`- ${mem.text}${tags} (${date})`);
        }
        parts.push("--- END MEMORY ---");
    }

    // 2. Semantic search based on last user message
    const lastUserMsg = [...recentMessages]
        .reverse()
        .find((m) => m.role === "user");
    if (lastUserMsg) {
        const relevant = await searchMemories(userId, lastUserMsg.content);
        const recentIds = new Set(recent.map((m) => m.id));
        const unique = relevant.filter((r) => !recentIds.has(r.memory.id));

        if (unique.length > 0) {
            parts.push("\n--- RELEVANT MEMORIES ---");
            for (const { memory, score } of unique) {
                parts.push(
                    `- ${memory.text} (relevance: ${(score * 100).toFixed(0)}%)`,
                );
            }
            parts.push("--- END RELEVANT ---");
        }
    }

    // 3. Recent chat messages (last 10)
    if (recentMessages.length > 0) {
        const last10 = recentMessages.slice(-10);
        parts.push("\n--- RECENT CHAT HISTORY ---");
        for (const msg of last10) {
            const prefix = msg.role === "user" ? "User" : "AI";
            parts.push(`${prefix}: ${msg.content.slice(0, 200)}`);
        }
        parts.push("--- END CHAT ---");
    }

    // NOTE: Vault context is now loaded SERVER-SIDE via /api/vault-context
    // and appended in useVoiceSession (per-user isolation)

    return NextResponse.json({ context: parts.join("\n") });
}
