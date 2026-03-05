import type { CounterType } from "@/types/animation";

/**
 * Looks for classification tags in the AI response.
 * The AI is instructed to append [COUNTER:type] tags at the end of its response.
 * Example: "Записал факт и создал задачу! [COUNTER:facts] [COUNTER:tasks]"
 *
 * Returns ALL detected counter types (supports multiple per message).
 */
const TAG_REGEX_GLOBAL = /\[COUNTER:(ideas|facts|persons|tasks)\]/gi;

export function detectCounterTypes(
    assistantResponse: string,
): CounterType[] {
    const types: CounterType[] = [];
    let match: RegExpExecArray | null;
    while ((match = TAG_REGEX_GLOBAL.exec(assistantResponse)) !== null) {
        types.push(match[1].toLowerCase() as CounterType);
    }
    // Reset lastIndex for reuse
    TAG_REGEX_GLOBAL.lastIndex = 0;
    return types;
}

/**
 * Legacy single-counter detection (for backward compat).
 */
export function detectCounterType(
    assistantResponse: string,
): CounterType | null {
    const types = detectCounterTypes(assistantResponse);
    return types.length > 0 ? types[0] : null;
}

/**
 * Strip ALL [COUNTER:...] tags from visible text.
 */
export function stripCounterTag(text: string): string {
    return text.replace(TAG_REGEX_GLOBAL, "").trimEnd();
}
