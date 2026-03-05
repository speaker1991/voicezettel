"use client";

import { ChatArea } from "@/components/chat/ChatArea";
import { InputBar } from "@/components/input/InputBar";
import { useChatStore } from "@/stores/chatStore";

/**
 * Wraps ChatArea + InputBar and hides them when orbMode is "agent".
 */
export function ChatSection() {
    const orbMode = useChatStore((s) => s.orbMode);

    if (orbMode === "agent") return null;

    return (
        <>
            <ChatArea />
            <InputBar />
        </>
    );
}
