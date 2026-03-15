/**
 * Strip DSML / function_call blocks that some LLMs (e.g. DeepSeek)
 * output as plain text instead of native tool calls.
 *
 * Handles multiple DSML tag formats (opening AND closing):
 * - < | DSML | function_calls>  /  </ | DSML | function_calls>
 * - <|DSML|function_calls>      /  </|DSML|function_calls>
 * - <DSML function_calls>       /  </DSML>
 * - <invoke ...>                /  </invoke>
 */
export function stripDSML(text: string): string {
    // Phase 1: Complete DSML-like blocks — remove everything from first opening/closing tag to end
    // Added \/? to also match closing tags like </ | DSML | ...>
    const fullIdx = text.search(
        /<\s*\/?\s*\|?\s*(?:DSML|function_calls?|antml|invoke\s*(?:name)?)[^]*$/i,
    );
    if (fullIdx !== -1) {
        return text.slice(0, fullIdx).trim();
    }

    // Phase 1b: Pipe-separated format: < | DSML |  or  </ | DSML |
    const pipeDsmlIdx = text.search(/<\s*\/?\s*\|\s*DSML/i);
    if (pipeDsmlIdx !== -1) {
        return text.slice(0, pipeDsmlIdx).trim();
    }

    // Phase 2: Partial tag at end of text (streaming)
    // Catches: "< |", "< | ", "< | D", "< | DS", "</ |", etc.
    const partialIdx = text.search(/<\s*\/?\s*\|[^>]*$/);
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
