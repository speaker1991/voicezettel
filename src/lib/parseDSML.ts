/**
 * Parse DSML function call blocks that DeepSeek outputs as text.
 *
 * Input format (DeepSeek style):
 *   < | DSML | function_calls>
 *   < | DSML | invoke name="create_zettel">
 *   < | DSML | parameter name="title" string="true">Some title</ | DSML | parameter>
 *   ...
 *   </ | DSML | invoke>
 *   </ | DSML | function_calls>
 */

export interface DSMLCall {
    name: string;
    params: Record<string, string>;
}

/**
 * Extract function calls from DSML text.
 * Returns an array of {name, params} objects.
 */
export function parseDSMLCalls(text: string): DSMLCall[] {
    const calls: DSMLCall[] = [];
    if (!text) return calls;

    // Match invoke blocks — flexible on pipe/space formatting
    // < | DSML | invoke name="create_zettel"> ... </ | DSML | invoke>
    const invokeRegex = /<[^>]*invoke\s+name="(\w+)"[^>]*>([\s\S]*?)(?:<[^>]*\/[^>]*invoke[^>]*>|$)/gi;

    let match;
    while ((match = invokeRegex.exec(text)) !== null) {
        const name = match[1];
        const body = match[2];
        const params: Record<string, string> = {};

        // Extract parameters
        // < | DSML | parameter name="title" string="true">value</ | DSML | parameter>
        const paramRegex = /<[^>]*parameter\s+name="(\w+)"[^>]*>([^<]*)/gi;
        let pm;
        while ((pm = paramRegex.exec(body)) !== null) {
            params[pm[1]] = pm[2].trim();
        }

        if (name) {
            calls.push({ name, params });
        }
    }

    return calls;
}

/**
 * Check if text contains DSML function calls.
 */
export function hasDSML(text: string): boolean {
    return /<[^>]*(?:DSML|function_calls)[^>]*>/i.test(text);
}

/**
 * Extract the clean text portion BEFORE any DSML blocks.
 */
export function extractTextBeforeDSML(text: string): string {
    const idx = text.search(/<[^>]*(?:DSML|function_calls)[^>]*>/i);
    if (idx === -1) return text;
    return text.slice(0, idx).trim();
}
