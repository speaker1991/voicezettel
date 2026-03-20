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
 * Async-iterable queue. Consumers block on `for await` until items are pushed.
 * No polling — uses Promise resolve callbacks for instant wakeup.
 */
export class AsyncQueue<T> {
    private buffer: T[] = [];
    private waiting: ((value: IteratorResult<T>) => void) | null = null;
    private finished = false;

    /** Add an item — wakes any waiting consumer immediately */
    push(item: T): void {
        if (this.waiting) {
            const resolve = this.waiting;
            this.waiting = null;
            resolve({ value: item, done: false });
        } else {
            this.buffer.push(item);
        }
    }

    /** Signal no more items will be pushed */
    finish(): void {
        this.finished = true;
        if (this.waiting) {
            const resolve = this.waiting;
            this.waiting = null;
            resolve({ value: undefined as unknown as T, done: true });
        }
    }

    async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
        while (true) {
            if (this.buffer.length > 0) {
                yield this.buffer.shift()!;
                continue;
            }
            if (this.finished) return;
            // Wait for next push or finish
            const result = await new Promise<IteratorResult<T>>((resolve) => {
                this.waiting = resolve;
            });
            if (result.done) return;
            yield result.value;
        }
    }
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
        if (!clean || clean.length < 2) {
            console.warn("[TTS] Text too short after cleanup, skipping:", JSON.stringify(text));
            return null;
        }
        console.log("[TTS] Fetching audio for:", clean.slice(0, 50), "voice:", voice);
        const res = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: clean, voice }),
        });
        if (!res.ok) {
            console.error("[TTS] /api/tts returned error:", res.status, await res.text().catch(() => ""));
            return null;
        }
        const blob = await res.blob();
        console.log("[TTS] Got audio blob:", blob.size, "bytes, type:", blob.type);
        return blob;
    } catch (err) {
        console.error("[TTS] prefetchEdgeTTS error:", err);
        return null;
    }
}

/**
 * Pre-fetch Local Silero TTS audio for a sentence.
 * Returns a Blob (audio/wav) or null on failure. Does NOT play anything.
 */
export async function prefetchLocalTTS(
    text: string,
    speaker: string = "xenia",
): Promise<Blob | null> {
    try {
        const clean = text
            .replace(/\[COUNTER:\w+\]/gi, "")
            .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1FFFF}]/gu, "")
            .replace(/[*_#>`~]/g, "")
            .replace(/\s{2,}/g, " ")
            .trim();
        if (!clean || clean.length < 2) return null;

        console.log("[TTS-Local] Fetching audio for:", clean.slice(0, 50), "speaker:", speaker);
        const res = await fetch("/api/tts-local", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: clean, voice: speaker }),
        });
        if (!res.ok) {
            console.error("[TTS-Local] /api/tts-local returned error:", res.status);
            return null;
        }
        const blob = await res.blob();
        console.log("[TTS-Local] Got audio blob:", blob.size, "bytes, type:", blob.type);
        return blob;
    } catch (err) {
        console.error("[TTS-Local] prefetchLocalTTS error:", err);
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

/**
 * Fallback TTS using browser-native Speech Synthesis.
 * Used when EdgeTTS server is unavailable.
 */
export function speakWithBrowserTTS(text: string): Promise<void> {
    return new Promise<void>((resolve) => {
        if (!("speechSynthesis" in window)) {
            resolve();
            return;
        }
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "ru-RU";
        utterance.rate = 1.1;
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();

        // iOS Safari sometimes needs a cancel before speak
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);

        // Watchdog: resolve after 15s even if onend never fires (iOS bug)
        setTimeout(resolve, 15000);
    });
}
