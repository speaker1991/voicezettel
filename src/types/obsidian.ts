import { z } from "zod";

export const ObsidianRequestSchema = z.object({
    userText: z.string().min(1),
    assistantText: z.string().min(1),
    obsidianApiKey: z.string().min(1),
    obsidianApiUrl: z.string().min(1),
    provider: z.enum(["openai", "google"]).default("openai"),
});

export type ObsidianRequest = z.infer<typeof ObsidianRequestSchema>;
