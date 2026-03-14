/**
 * @module api/memories
 * API route for fetching, searching, and deleting user memories.
 *
 * GET ?userId=...&recent=20 — get recent memories
 * GET ?userId=...&q=...     — semantic search
 * DELETE ?userId=...&id=... — delete a memory
 */
import { NextRequest, NextResponse } from "next/server";
import { getRecentMemories, searchMemories, getMemoryCount, deleteMemory } from "@/lib/memoryStore";

export async function GET(req: NextRequest) {
    const { searchParams } = req.nextUrl;
    const userId = searchParams.get("userId");

    if (!userId) {
        return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const query = searchParams.get("q");
    const recentN = parseInt(searchParams.get("recent") ?? "50", 10);

    try {
        if (query && query.trim().length > 0) {
            // Semantic search
            const results = await searchMemories(userId, query);
            return NextResponse.json({
                memories: results.map((r) => ({
                    id: r.memory.id,
                    text: r.memory.text,
                    tags: r.memory.tags,
                    createdAt: r.memory.createdAt,
                    relevance: Math.round(r.score * 100),
                })),
            });
        }

        // Recent memories
        const memories = await getRecentMemories(userId, recentN);
        const count = await getMemoryCount(userId);
        return NextResponse.json({
            memories: memories.map((m) => ({
                id: m.id,
                text: m.text,
                tags: m.tags,
                createdAt: m.createdAt,
            })),
            total: count,
        });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Unknown error" },
            { status: 500 },
        );
    }
}

export async function DELETE(req: NextRequest) {
    const { searchParams } = req.nextUrl;
    const userId = searchParams.get("userId");
    const id = searchParams.get("id");

    if (!userId || !id) {
        return NextResponse.json({ error: "userId and id are required" }, { status: 400 });
    }

    try {
        const deleted = await deleteMemory(userId, id);
        return NextResponse.json({ deleted });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Unknown error" },
            { status: 500 },
        );
    }
}
