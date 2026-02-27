import { z } from "zod";

// ── Transcript entry ─────────────────────────────────────────
export const TranscriptEntrySchema = z.object({
    id: z.string(),
    text: z.string(),
    timestamp: z.string(),
    speaker: z.enum(["user", "other", "unknown"]).default("unknown"),
});

export type TranscriptEntry = z.infer<typeof TranscriptEntrySchema>;

// ── Meeting summary ──────────────────────────────────────────
export const MeetingSummarySchema = z.object({
    duration: z.string(),
    totalEntries: z.number(),
    summary: z.string(),
});

export type MeetingSummary = z.infer<typeof MeetingSummarySchema>;

// ── Lavalier mode state ──────────────────────────────────────
export type LavalierState = "inactive" | "listening" | "paused";
