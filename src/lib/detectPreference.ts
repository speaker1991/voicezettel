/**
 * Parse and strip [SAVE_PREF:...] tags from assistant responses.
 */

const PREF_REGEX = /\[SAVE_PREF:([^\]]+)\]/g;

/**
 * Extract all behavior preferences from assistant text.
 */
export function extractPreferences(text: string): string[] {
    const prefs: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = PREF_REGEX.exec(text)) !== null) {
        const rule = match[1].trim();
        if (rule) prefs.push(rule);
    }
    PREF_REGEX.lastIndex = 0;
    return prefs;
}

/**
 * Strip all [SAVE_PREF:...] tags from visible text.
 */
export function stripPrefTag(text: string): string {
    return text.replace(PREF_REGEX, "").trimEnd();
}
