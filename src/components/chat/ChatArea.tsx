"use client";

import { useRef, useEffect } from "react";
import { useChatStore } from "@/stores/chatStore";
import type { Message } from "@/types/chat";

function bubbleClasses(role: Message["role"]): string {
    if (role === "user") {
        return "ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-violet-600 px-4 py-2.5 text-sm text-white";
    }
    if (role === "assistant") {
        return "mr-auto max-w-[80%] rounded-2xl rounded-bl-sm bg-zinc-800 px-4 py-2.5 text-sm text-zinc-100";
    }
    return "mx-auto max-w-[80%] rounded-xl bg-zinc-900 px-3 py-1.5 text-center text-xs text-zinc-500";
}

function MessageBubble({ message }: { message: Message }) {
    return (
        <div className={bubbleClasses(message.role)}>
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
            {message.metadata?.rewardType && (
                <span className="mt-1 block text-[10px] uppercase tracking-widest text-violet-300/60">
                    {message.metadata.rewardType}
                </span>
            )}
        </div>
    );
}

export function ChatArea() {
    const messages = useChatStore((s) => s.messages);
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    if (messages.length === 0) {
        return (
            <div className="flex flex-1 flex-col items-center overflow-y-auto py-6">
                <p className="mt-auto text-sm text-zinc-600">
                    No messages yet
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto py-6">
            {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
            ))}
            <div ref={bottomRef} />
        </div>
    );
}
