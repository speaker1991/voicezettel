import { z } from "zod";

// ── Admin sidebar tabs ───────────────────────────────────────
export const AdminTabSchema = z.enum([
    "dashboard",
    "logs",
    "prompts",
    "sessions",
    "settings",
]);

export type AdminTab = z.infer<typeof AdminTabSchema>;

// ── KPI card data ────────────────────────────────────────────
export const KpiCardSchema = z.object({
    id: z.string(),
    icon: z.string(),
    label: z.string(),
    value: z.string(),
    sub: z.string(),
    trend: z.enum(["up", "down", "neutral"]),
    progress: z.number().min(0).max(100).optional(),
});

export type KpiCard = z.infer<typeof KpiCardSchema>;

// ── Service status ───────────────────────────────────────────
export const ServiceStatusSchema = z.enum(["online", "degraded", "offline"]);

export const ServiceEntrySchema = z.object({
    name: z.string(),
    status: ServiceStatusSchema,
    latency: z.string(),
    uptime: z.string(),
});

export type ServiceEntry = z.infer<typeof ServiceEntrySchema>;
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;

// ── Log entry ────────────────────────────────────────────────
export const LogLevelSchema = z.enum(["INFO", "WARN", "ERROR"]);

export const LogEntrySchema = z.object({
    id: z.string(),
    time: z.string(),
    level: LogLevelSchema,
    source: z.string(),
    message: z.string(),
});

export type LogLevel = z.infer<typeof LogLevelSchema>;
export type LogEntry = z.infer<typeof LogEntrySchema>;

// ── Activity feed ────────────────────────────────────────────
export const ActivityItemSchema = z.object({
    id: z.string(),
    icon: z.string(),
    title: z.string(),
    desc: z.string(),
    time: z.string(),
});

export type ActivityItem = z.infer<typeof ActivityItemSchema>;
