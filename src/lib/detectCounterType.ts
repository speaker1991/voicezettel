import type { CounterType } from "@/types/animation";

/**
 * Looks for a classification tag in the AI response.
 * The AI is instructed to append [COUNTER:type] at the end of its response.
 * Example: "Заметка создана! [COUNTER:tasks]"
 */
const TAG_REGEX = /\[COUNTER:(ideas|facts|persons|tasks)\]/i;

export function detectCounterType(
    assistantResponse: string,
): CounterType | null {
    const match = TAG_REGEX.exec(assistantResponse);
    if (!match) return null;
    return match[1].toLowerCase() as CounterType;
}

/**
 * Strip the [COUNTER:...] tag from visible text.
 */
export function stripCounterTag(text: string): string {
    return text.replace(TAG_REGEX, "").trimEnd();
}
