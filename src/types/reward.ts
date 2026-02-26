import { z } from "zod";

// ── Zod schema ───────────────────────────────────────────────
export const RewardSchema = z.object({
    id: z.string(),
    type: z.enum(["note", "insight", "rag", "task"]),
    timestamp: z.string(),
});

// ── Inferred TypeScript type ─────────────────────────────────
export type Reward = z.infer<typeof RewardSchema>;
