import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { RemoteLogPayloadSchema } from "@/types/admin";
import type { StoredLog } from "@/types/admin";

const DATA_DIR = path.join(process.cwd(), "data", "logs");
const MAX_LOGS_PER_USER = 500;

function sanitizeUserId(userId: string): string {
    return userId.replace(/[^a-zA-Z0-9@._-]/g, "_").slice(0, 100);
}

function getLogFilePath(userId: string): string {
    return path.join(DATA_DIR, `${sanitizeUserId(userId)}.json`);
}

async function readLogs(userId: string): Promise<StoredLog[]> {
    try {
        const filePath = getLogFilePath(userId);
        const data = await fs.readFile(filePath, "utf-8");
        return JSON.parse(data) as StoredLog[];
    } catch {
        return [];
    }
}

async function writeLogs(userId: string, logs: StoredLog[]): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const filePath = getLogFilePath(userId);
    await fs.writeFile(filePath, JSON.stringify(logs, null, 2), "utf-8");
}

// POST — append log entry
export async function POST(req: NextRequest): Promise<NextResponse> {
    try {
        const body: unknown = await req.json();
        const parsed = RemoteLogPayloadSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                { error: "Invalid log payload", details: parsed.error.format() },
                { status: 400 },
            );
        }

        const { userId, level, source, message, category, context } = parsed.data;

        const entry: StoredLog = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            userId,
            level,
            source,
            message,
            category,
            context,
        };

        const logs = await readLogs(userId);
        logs.push(entry);

        // Keep only last N logs per user
        const trimmed = logs.slice(-MAX_LOGS_PER_USER);
        await writeLogs(userId, trimmed);

        return NextResponse.json({ ok: true, id: entry.id });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Unknown error" },
            { status: 500 },
        );
    }
}

// GET — read logs for a user (?userId=xxx) or all users
export async function GET(req: NextRequest): Promise<NextResponse> {
    try {
        const userId = req.nextUrl.searchParams.get("userId");

        if (userId) {
            const logs = await readLogs(userId);
            return NextResponse.json({ logs });
        }

        // No userId — return all users' logs merged
        await fs.mkdir(DATA_DIR, { recursive: true });
        const files = await fs.readdir(DATA_DIR);
        const allLogs: StoredLog[] = [];

        for (const file of files) {
            if (!file.endsWith(".json")) continue;
            try {
                const data = await fs.readFile(path.join(DATA_DIR, file), "utf-8");
                const logs = JSON.parse(data) as StoredLog[];
                allLogs.push(...logs);
            } catch {
                // Skip corrupted files
            }
        }

        // Sort by timestamp descending
        allLogs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

        return NextResponse.json({ logs: allLogs.slice(0, 1000) });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Unknown error" },
            { status: 500 },
        );
    }
}
