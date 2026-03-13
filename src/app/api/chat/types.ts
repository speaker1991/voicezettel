import { z } from "zod";

export const ChatRequestSchema = z.object({
    messages: z.array(
        z.object({
            role: z.enum(["user", "assistant", "system"]),
            content: z.string(),
        }),
    ),
    provider: z.enum(["openai", "google", "deepseek"]).default("openai"),
    systemPrompt: z.string().optional(),
    userId: z.string().default("anonymous"),
    source: z.enum(["text", "voice"]).default("text"),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;
