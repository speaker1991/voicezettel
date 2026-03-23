import { NextRequest, NextResponse } from "next/server";
import { loadVaultContext } from "@/lib/vaultContext";
import { logger } from "@/lib/logger";

const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;

/**
 * Extract just title + short essence from each Zettelkasten note.
 * Deduplicates by normalized title. Returns newest first.
 */
function condenseVaultNotes(rawContext: string): string {
    const notes = rawContext.split(/\n---\s+\//).filter(Boolean);
    const seen = new Set<string>();
    const condensed: string[] = [];

    // Reverse so newest (last alphabetically / last loaded) come first
    for (const note of notes.reverse()) {
        const titleMatch = /^#\s+(.+)$/m.exec(note);
        const suttMatch = /^##\s+Суть\s*\n(.+)$/m.exec(note);
        
        let title = titleMatch ? titleMatch[1].trim() : "";
        let essence = "";

        // Zettelkasten: get from 💡 section
        const essenceMatch = /###\s+💡[^\n]*\n([\s\S]*?)(?=\n###|\n---|\n$)/m.exec(note);
        if (essenceMatch) {
            essence = essenceMatch[1].trim().split("\n")[0].trim();
        }
        // Classifier: get from ## Суть  
        if (!essence && suttMatch) {
            essence = suttMatch[1].trim();
        }
        // Fallback: blockquote
        if (!essence) {
            const ctxMatch = />\s*(.+)/m.exec(note);
            if (ctxMatch) essence = ctxMatch[1].trim();
        }

        if (!title && !essence) continue;
        if (!title) title = essence;

        // Dedup by normalized title
        const key = title.toLowerCase().replace(/[^а-яa-z0-9]/g, "").slice(0, 40);
        if (seen.has(key)) continue;
        seen.add(key);

        // Just title — it already contains the key fact
        condensed.push(`• ${title}`);
    }

    return condensed.join("\n");
}

export async function POST(req: NextRequest) {
    if (!GOOGLE_GEMINI_API_KEY) {
        return NextResponse.json(
            { error: "GOOGLE_GEMINI_API_KEY is not configured on the server." },
            { status: 501 },
        );
    }

    let userId = "anonymous";
    try {
        const body = await req.json() as { userId?: string };
        if (body.userId) userId = body.userId;
    } catch {
        // нет тела — anonymous
    }

    // Загружаем заметки Obsidian и конденсируем на сервере
    let condensedVault = "";
    try {
        const rawVault = await loadVaultContext(userId);
        if (rawVault.length > 0) {
            condensedVault = condenseVaultNotes(rawVault);
        }
    } catch {
        // продолжаем без контекста
    }

    // WS URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const wsUrl = appUrl
        ? `${appUrl.replace("http://", "ws://").replace("https://", "wss://")}/ws-gemini`
        : "ws://localhost:3099";

    // eslint-disable-next-line no-console
    console.log(`[GeminiLiveToken] userId=${userId}, condensedVault=${condensedVault.length}ch`);
    
    // Check for Красотка in condensed
    if (condensedVault.includes("Красотка")) {
        // eslint-disable-next-line no-console
        console.log("[GeminiLiveToken] ✅ 'Красотка' in condensed vault!");
    } else {
        // eslint-disable-next-line no-console
        console.log("[GeminiLiveToken] ❌ 'Красотка' NOT in condensed vault");
    }

    logger.info(`[GeminiLiveToken] userId=${userId}, condensedVault=${condensedVault.length}`);

    return NextResponse.json({ wsUrl, vaultContext: condensedVault });
}
