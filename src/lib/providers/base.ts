import { logger } from "@/lib/logger";

// ── Shared types for LLM providers ──

export interface ChatMessage {
    role: string;
    content: string;
}

export interface ToolCall {
    id: string;
    function: {
        name: string;
        arguments: string;
    };
}

export interface ToolCallResult {
    finalMessages: Array<Record<string, unknown>>;
    needsStream: boolean;
}

/**
 * Base interface for all LLM providers.
 * Each provider converts messages + system prompt into an SSE ReadableStream
 * in OpenAI-compatible format (data: {"choices":[{"delta":{"content":"..."}}]}).
 */
export interface LLMProvider {
    readonly name: string;
    streamChat(
        messages: Array<Record<string, unknown>>,
        systemPrompt?: string,
    ): Promise<ReadableStream<Uint8Array>>;
}

/**
 * Provider that supports native function calling (tool_choice: auto).
 * First pass is non-streaming to detect tool calls, then re-streams.
 */
export interface LLMProviderWithTools extends LLMProvider {
    callWithTools(
        userId: string,
        messages: ChatMessage[],
        systemPrompt: string,
    ): Promise<ToolCallResult>;
}

/** SSE response headers (reused across all providers) */
export const SSE_HEADERS = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
} as const;

/**
 * Strip tool/function names from prompt text.
 * Used when falling back to providers that don't support native function calling.
 */
export function stripToolInstructions(prompt: string): string {
    return prompt
        .replace(/save_memory|search_memory|create_zettel|tool_choice/gi, "")
        .replace(/вызвать\s+\w+/gi, "запомнить");
}

export { logger };
