import { type ChatMessage, type ToolCall, type ToolCallResult, type LLMProvider, type LLMProviderWithTools, logger } from "./base";
import { MEMORY_TOOLS, handleToolCalls } from "@/lib/chatTools";

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

/** DeepSeek streaming (OpenAI-compatible API) */
async function streamDeepSeek(
    messages: Array<Record<string, unknown>>,
): Promise<ReadableStream<Uint8Array>> {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "deepseek-chat",
            stream: true,
            stream_options: { include_usage: true },
            messages,
        }),
    });

    if (!res.ok || !res.body) {
        const errText = await res.text();
        throw new Error(`DeepSeek error ${res.status}: ${errText}`);
    }

    return res.body;
}

/** DeepSeek function calling (non-streaming first pass) */
async function callDeepSeekWithTools(
    userId: string,
    messages: ChatMessage[],
    systemPrompt: string,
): Promise<ToolCallResult> {
    const apiMessages: Array<Record<string, unknown>> = [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "deepseek-chat",
            messages: apiMessages,
            tools: MEMORY_TOOLS,
            tool_choice: "auto",
        }),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`DeepSeek error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as {
        choices?: Array<{
            message?: {
                role?: string;
                content?: string | null;
                tool_calls?: ToolCall[];
            };
            finish_reason?: string;
        }>;
    };

    const choice = data.choices?.[0];
    const assistantMessage = choice?.message;

    logger.info(`DeepSeek tools: finish_reason=${choice?.finish_reason}, tool_calls=${assistantMessage?.tool_calls?.length ?? 0}, content=${(assistantMessage?.content ?? "").slice(0, 100)}`);

    if (
        (choice?.finish_reason === "tool_calls" || assistantMessage?.tool_calls?.length) &&
        assistantMessage?.tool_calls
    ) {
        const toolResults = await handleToolCalls(userId, assistantMessage.tool_calls);
        apiMessages.push({
            role: "assistant",
            content: assistantMessage.content ?? null,
            tool_calls: assistantMessage.tool_calls,
        });
        for (const result of toolResults) {
            apiMessages.push(result);
        }
        return { finalMessages: apiMessages, needsStream: true };
    }

    return { finalMessages: apiMessages, needsStream: true };
}

export const deepseekProvider: LLMProviderWithTools = {
    name: "deepseek",
    streamChat: streamDeepSeek,
    callWithTools: callDeepSeekWithTools,
};
