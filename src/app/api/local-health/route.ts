import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy /local-api/health → local_core:8000/health
 * Avoids mixed-content issues (HTTPS page → HTTP localhost).
 */
export async function GET(_req: NextRequest) {
    const LOCAL_CORE_URL = process.env.LOCAL_CORE_URL ?? "http://localhost:8000";

    try {
        const res = await fetch(`${LOCAL_CORE_URL}/health`, {
            signal: AbortSignal.timeout(2000),
        });

        if (!res.ok) {
            return NextResponse.json({ status: "error" }, { status: 502 });
        }

        const data = (await res.json()) as Record<string, unknown>;
        return NextResponse.json(data);
    } catch {
        return NextResponse.json({ status: "offline" }, { status: 503 });
    }
}
