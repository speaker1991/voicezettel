/**
 * Strip DSML / function_call blocks that some LLMs (e.g. DeepSeek)
 * output as plain text instead of native tool calls.
 *
 * Two-phase detection:
 * 1. Find complete DSML-like opening tags and cut from there.
 * 2. Detect PARTIAL tags still being streamed (e.g. "< |", "< | D", "< | DSM")
 *    and strip those too — they never appear in legitimate text.
 */
export function stripDSML(text: string): string {
    // Phase 1: Complete DSML tag detected — cut everything from there
    const fullIdx = text.search(
        /<\s*\|?\s*(?:DSML|function_calls?|antml|invoke\s+name)/i,
    );
    if (fullIdx !== -1) {
        return text.slice(0, fullIdx).trim();
    }

    // Phase 2: Partial tag at end of text (streaming)
    // Catches: "<", "< ", "< |", "< | ", "< | D", "< | DS", "< | DSM", etc.
    // In normal Russian/English text, "< |" never appears legitimately.
    const partialIdx = text.search(/<\s*\|[^>]*$/);
    if (partialIdx !== -1) {
        return text.slice(0, partialIdx).trim();
    }

    // Phase 3: Just a trailing "<" with optional whitespace at very end
    // Could be the start of a DSML tag
    const trailingAngle = text.search(/<\s*$/);
    if (trailingAngle !== -1 && text.length - trailingAngle <= 3) {
        return text.slice(0, trailingAngle).trim();
    }

    return text;
}
