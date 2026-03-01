import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeNoteToVault } from "@/lib/vaultWriter";
import { logger } from "@/lib/logger";

const ArchiveSchema = z.object({
    messages: z.array(
        z.object({
            role: z.enum(["user", "assistant", "system"]),
            content: z.string(),
            timestamp: z.string(),
        }),
    ),
});

export async function POST(req: NextRequest) {
    const raw: unknown = await req.json();
    const parsed = ArchiveSchema.safeParse(raw);

    if (!parsed.success) {
        return NextResponse.json(
            { error: "Invalid request", details: parsed.error.flatten() },
            { status: 400 },
        );
    }

    const { messages } = parsed.data;

    if (messages.length === 0) {
        return NextResponse.json(
            { error: "No messages to archive" },
            { status: 400 },
        );
    }

    // Build markdown content
    const now = new Date();
    const dateStr = now.toISOString().replace(/[-T:.Z]/g, "").slice(0, 14);
    const readableDate = now.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
    });
    const readableTime = now.toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
    });

    const lines: string[] = [
        `---`,
        `type: session-archive`,
        `created: ${now.toISOString()}`,
        `messages: ${messages.length}`,
        `---`,
        ``,
        `# Session ${readableDate} ${readableTime}`,
        ``,
    ];

    for (const msg of messages) {
        const time = new Date(msg.timestamp).toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
        });

        if (msg.role === "user") {
            lines.push(`### 🧑 User (${time})`);
        } else if (msg.role === "assistant") {
            lines.push(`### 🤖 Assistant (${time})`);
        } else {
            continue; // skip system messages
        }

        lines.push(msg.content);
        lines.push("");
    }

    const markdown = lines.join("\n");
    const fileName = `${now.toISOString().slice(0, 10)}_${now.toISOString().slice(11, 19).replace(/:/g, "-")}`;

    const result = await writeNoteToVault(fileName, markdown, "Archive");

    if (result.success) {
        logger.debug(
            `Session archived: ${fileName}.md (${messages.length} messages)`,
        );
        return NextResponse.json({
            success: true,
            file: `Archive/${fileName}.md`,
            messages: messages.length,
        });
    }

    logger.error(`Archive failed: ${result.error}`);
    return NextResponse.json(
        { error: result.error },
        { status: 500 },
    );
}
