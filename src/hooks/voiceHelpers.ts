/**
 * Pure helper functions for the voice pipeline.
 * No React hooks — safe to import anywhere.
 */

import { stripDSML } from "@/lib/stripDSML";
import { detectCounterTypes, stripCounterTag } from "@/lib/detectCounterType";
import { stripPrefTag } from "@/lib/detectPreference";

/* ─── Types ─── */
export interface SentenceJob {
    text: string;
    blobPromise: Promise<Blob | null>;
}

/**
 * Pre-fetch EdgeTTS audio for a sentence.
 * Returns a Blob or null on failure. Does NOT play anything.
 */
export async function prefetchEdgeTTS(text: string, voice: string): Promise<Blob | null> {
    try {
        // Strip emoji, counter tags, and markdown before TTS
        const clean = text
            .replace(/\[COUNTER:\w+\]/gi, "")
            .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1FFFF}]/gu, "")
            .replace(/[*_#>`~]/g, "")
            .replace(/\s{2,}/g, " ")
            .trim();
        if (!clean || clean.length < 2) return null;
        const res = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: clean, voice }),
        });
        if (!res.ok) return null;
        return await res.blob();
    } catch {
        return null;
    }
}

/**
 * Clean assistant response text: strip DSML, counter tags, preferences, JSON artifacts.
 */
export function cleanResponseText(raw: string): string {
    let text = stripDSML(raw);
    const counterTypes = detectCounterTypes(text);
    if (counterTypes.length > 0) text = stripCounterTag(text);
    text = stripPrefTag(text);
    text = text.replace(/^\{["']?\s*/, "").replace(/\s*["']?\}$/, "");
    text = text.replace(/^["']+|["']+$/g, "");
    text = text.replace(/\\n/g, "\n").trim();
    return text;
}

/**
 * Calculate audio level from an AnalyserNode.
 * Returns 0-1 normalized value.
 */
export function getAudioLevel(
    analyser: AnalyserNode | null,
    dataArray: Uint8Array<ArrayBuffer> | null,
): number {
    if (!analyser || !dataArray) return 0;
    analyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
    }
    return Math.min(sum / (dataArray.length * 128), 1);
}
