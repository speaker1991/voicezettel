import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { saveMemory } from "@/lib/memoryStore";
import { classifyAndSave } from "@/lib/messageClassifier";
import { logger } from "@/lib/logger";

const SaveSchema = z.object({
    userId: z.string(),
    userText: z.string().optional(),
    assistantText: z.string().optional(),
});

/**
 * POST /api/voice-memory
 * Saves voice session transcripts to memory + runs classifier.
 * Returns counter tags to trigger animations on the client.
 */
export async function POST(req: NextRequest) {
    const raw: unknown = await req.json();
    const parsed = SaveSchema.safeParse(raw);

    if (!parsed.success) {
        return NextResponse.json({ error: "Invalid" }, { status: 400 });
    }

    const { userId, userText, assistantText } = parsed.data;
    let saved = 0;
    let counterTags: string[] = [];

    // Save user's spoken words as memory
    if (userText && userText.trim().length > 10) {
        const cleaned = userText.trim();
        const skipPatterns = /^(привет|здравствуй|окей|хорошо|спасибо|пока|да|нет|ладно|ага|угу)/i;
        if (!skipPatterns.test(cleaned)) {
            await saveMemory(
                userId,
                `Пользователь сказал: ${cleaned}`,
                ["voice", "user-said"],
            );
            saved++;

            // Run classifier on user's speech
            const classified = await classifyAndSave(userId, cleaned);
            counterTags = classified.counterTags;
        }
    }

    // Save assistant's response as memory
    if (assistantText && assistantText.trim().length > 20) {
        const cleaned = assistantText.trim();
        await saveMemory(
            userId,
            `Ассистент ответил: ${cleaned.slice(0, 300)}`,
            ["voice", "assistant-said"],
        );
        saved++;
    }

    if (saved > 0) {
        logger.debug(`Voice memory: saved ${saved} entries for ${userId}`);
    }

    return NextResponse.json({ saved, counterTags });
}
