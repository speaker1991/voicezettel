/**
 * Strip DSML / function_call blocks that some LLMs (e.g. DeepSeek)
 * output as plain text instead of native tool calls.
 *
 * Handles ALL DSML tag formats (opening AND closing):
 * - <|DSML|function_calls>  /  </|DSML|function_calls>
 * - < | DSML | function_calls>  /  </ | DSML | function_calls>
 * - <invoke name="...">  /  </invoke>
 * - <parameter name="...">  /  </parameter>
 */
export function stripDSML(text: string): string {
    // Phase 0: Remove COMPLETE closed DSML blocks (opening + closing tag pairs)
    // This handles cases where the DSML block starts at the very beginning of the response.
    text = text.replace(
        /<\s*\|?\s*(?:DSML|function_calls?|antml|invoke|parameter)[^>]*>[\s\S]*?<\/\s*\|?\s*(?:DSML|function_calls?|antml|invoke|parameter)[^>]*>/gi,
        "",
    );
    // Phase 0b: Remove unclosed DSML blocks from first opening tag to end of string
    text = text.replace(
        /<\s*\|?\s*(?:DSML|function_calls?|antml|invoke|parameter)[\s\S]*/gi,
        "",
    );

    // Phase 1: Complete DSML-like blocks — remove from first tag (opening or closing) to end.
    const fullIdx = text.search(
        /<\s*\/?\s*\|?\s*(?:DSML|function_calls?|antml|invoke|parameter)[^]*$/i,
    );
    if (fullIdx !== -1) {
        return text.slice(0, fullIdx).trim();
    }

    // Phase 1b: Pipe-separated format: < | DSML | ... or </ | DSML | ...
    const pipeDsmlIdx = text.search(/<\s*\/?\s*\|\s*DSML/i);
    if (pipeDsmlIdx !== -1) {
        return text.slice(0, pipeDsmlIdx).trim();
    }

    // Phase 2: Partial tag building up at end of string (during streaming).
    // Catches: "</", "</ ", "</ |", "< |", "< | D", "</inv", etc.
    const partialIdx = text.search(/<\s*[\/|][^>]*$/);
    if (partialIdx !== -1) {
        return text.slice(0, partialIdx).trim();
    }

    // Phase 3: Just a trailing "<" at very end (next chunk might be "/" or "|")
    const trailingAngle = text.search(/<\s*$/);
    if (trailingAngle !== -1 && text.length - trailingAngle <= 3) {
        return text.slice(0, trailingAngle).trim();
    }

    // Phase 4: Strip [COUNTER:*] and [SAVE_PREF:*] tags — for counter/pref logic, not display/TTS
    text = text.replace(/\[COUNTER:[a-z]+\]/gi, "");
    text = text.replace(/\[SAVE_PREF:[^\]]*\]/gi, "");

    return text.trim() || text;
}
