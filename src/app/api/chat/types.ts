import { z } from "zod";

export const ChatRequestSchema = z.object({
    messages: z.array(
        z.object({
            role: z.enum(["user", "assistant", "system"]),
            content: z.string(),
        }),
    ),
    provider: z.enum(["openai", "google"]).default("openai"),
    systemPrompt: z.string().optional(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;
