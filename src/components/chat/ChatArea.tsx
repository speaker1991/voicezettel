"use client";

import { useRef, useEffect } from "react";
import { useChatStore } from "@/stores/chatStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useElevenLabsTTS } from "@/hooks/useElevenLabsTTS";
import type { Message } from "@/types/chat";

function bubbleClasses(role: Message["role"]): string {
    if (role === "user") {
        return "ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-[#7F22FE] px-4 py-2.5 text-sm text-white";
    }
    if (role === "assistant") {
        return "mr-auto max-w-[80%] rounded-2xl rounded-bl-sm bg-[#BA38BE] px-4 py-2.5 text-sm text-zinc-100";
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
    const orbState = useChatStore((s) => s.orbState);
    const bottomRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const scrollTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
    const spokenIdRef = useRef<string | null>(null);

    // TTS
    const { speak } = useElevenLabsTTS();
    const aiVoiceEnabled = useSettingsStore((s) => s.aiVoiceEnabled);
    const ttsProvider = useSettingsStore((s) => s.ttsProvider);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Auto-speak completed assistant messages via ElevenLabs
    useEffect(() => {
        if (orbState !== "idle") return;
        if (!aiVoiceEnabled || ttsProvider !== "elevenlabs") return;

        const lastMsg = messages[messages.length - 1];
        if (
            lastMsg &&
            lastMsg.role === "assistant" &&
            lastMsg.source === "text" &&
            lastMsg.id !== "seed-1" &&
            lastMsg.id !== spokenIdRef.current
        ) {
            spokenIdRef.current = lastMsg.id;
            void speak(lastMsg.content);
        }
    }, [orbState, messages, aiVoiceEnabled, ttsProvider, speak]);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;

        const onScroll = () => {
            el.classList.add("is-scrolling");
            clearTimeout(scrollTimer.current);
            scrollTimer.current = setTimeout(() => {
                el.classList.remove("is-scrolling");
            }, 1500);
        };

        el.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            el.removeEventListener("scroll", onScroll);
            clearTimeout(scrollTimer.current);
        };
    }, []);

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
        <div className="relative flex flex-1 flex-col min-h-0">
            {/* Gradient fade at top — messages disappear behind orb */}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-40 bg-gradient-to-b from-zinc-950 via-zinc-950/50 to-transparent" />

            <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto py-6 pr-5 chat-scrollbar">
                {/* Spacer pushes messages to bottom when few */}
                <div className="flex-1" />
                {messages.map((msg) => (
                    <MessageBubble key={msg.id} message={msg} />
                ))}
                <div ref={bottomRef} />
            </div>
        </div>
    );
}
