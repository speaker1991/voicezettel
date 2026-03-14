/**
 * Strip DSML / function_call blocks that some LLMs (e.g. DeepSeek)
 * output as plain text instead of native tool calls.
 *
 * Handles multiple DSML tag formats:
 * - < | DSML | function_calls>  (spaces + pipes between each part)
 * - <|DSML|function_calls>      (no spaces)
 * - <DSML function_calls>       (no pipes)
 * - <invoke ...>                (Anthropic format)
 */
export function stripDSML(text: string): string {
    // Phase 1: Complete DSML-like blocks — remove everything from first tag to end
    const fullIdx = text.search(
        /<\s*\|?\s*(?:DSML|function_calls?|antml|invoke\s+name)[^]*$/i,
    );
    if (fullIdx !== -1) {
        return text.slice(0, fullIdx).trim();
    }

    // Phase 1b: Pipe-separated format: < | DSML |
    const pipeDsmlIdx = text.search(/<\s*\|\s*DSML/i);
    if (pipeDsmlIdx !== -1) {
        return text.slice(0, pipeDsmlIdx).trim();
    }

    // Phase 2: Partial tag at end of text (streaming)
    // Catches: "< |", "< | ", "< | D", "< | DS", etc.
    const partialIdx = text.search(/<\s*\|[^>]*$/);
    if (partialIdx !== -1) {
        return text.slice(0, partialIdx).trim();
    }

    // Phase 3: Just a trailing "<" with optional whitespace at very end
    const trailingAngle = text.search(/<\s*$/);
    if (trailingAngle !== -1 && text.length - trailingAngle <= 3) {
        return text.slice(0, trailingAngle).trim();
    }

    return text;
}
