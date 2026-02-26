"use client";

import { useState, useCallback, type FormEvent } from "react";
import { Mic, MicOff, SendHorizontal, ImagePlus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChatStore } from "@/stores/chatStore";
import { useVoiceSession } from "@/hooks/useVoiceSession";

export function InputBar() {
    const [text, setText] = useState("");
    const { isVoiceActive, startVoice, stopVoice } = useVoiceSession();
    const addMessage = useChatStore((s) => s.addMessage);

    const handleSend = useCallback(() => {
        const trimmed = text.trim();
        if (!trimmed) return;

        addMessage({
            id: crypto.randomUUID(),
            role: "user",
            content: trimmed,
            timestamp: new Date().toISOString(),
            source: "text",
        });
        setText("");
    }, [text, addMessage]);

    const handleSubmit = useCallback(
        (e: FormEvent) => {
            e.preventDefault();
            handleSend();
        },
        [handleSend],
    );

    const handleMicClick = useCallback(() => {
        if (isVoiceActive) {
            stopVoice();
        } else {
            void startVoice();
        }
    }, [isVoiceActive, startVoice, stopVoice]);

    return (
        <form
            onSubmit={handleSubmit}
            className="shrink-0 border-t border-white/5 py-3"
        >
            <div className="flex w-full items-center gap-2">
                {/* Mic toggle */}
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={`relative shrink-0 ${isVoiceActive
                            ? "text-violet-400"
                            : "text-zinc-400 hover:text-violet-400"
                        }`}
                    aria-label={
                        isVoiceActive
                            ? "Stop voice input"
                            : "Start voice input"
                    }
                    onClick={handleMicClick}
                >
                    <AnimatePresence mode="wait">
                        {isVoiceActive ? (
                            <motion.span
                                key="mic-off"
                                initial={{ scale: 0.6, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.6, opacity: 0 }}
                                transition={{ duration: 0.15 }}
                            >
                                <MicOff className="size-4" />
                            </motion.span>
                        ) : (
                            <motion.span
                                key="mic-on"
                                initial={{ scale: 0.6, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.6, opacity: 0 }}
                                transition={{ duration: 0.15 }}
                            >
                                <Mic className="size-4" />
                            </motion.span>
                        )}
                    </AnimatePresence>

                    {/* Pulse ring when recording */}
                    {isVoiceActive && (
                        <motion.span
                            className="absolute inset-0 rounded-full border border-violet-400/40"
                            initial={{ scale: 1, opacity: 0.6 }}
                            animate={{
                                scale: [1, 1.6, 1],
                                opacity: [0.6, 0, 0.6],
                            }}
                            transition={{
                                duration: 1.4,
                                repeat: Infinity,
                                ease: "easeOut",
                            }}
                        />
                    )}
                </Button>

                {/* Text input */}
                <Input
                    placeholder={
                        isVoiceActive
                            ? "Voice active — speak or type…"
                            : "Type a message…"
                    }
                    className="flex-1 border-white/10 bg-white/5 placeholder:text-zinc-600 focus-visible:border-violet-500/50 focus-visible:ring-violet-500/20"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                />

                {/* Image button */}
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-zinc-400 hover:text-violet-400"
                    aria-label="Send image"
                >
                    <ImagePlus className="size-4" />
                </Button>

                {/* Send button */}
                <Button
                    type="submit"
                    size="icon-sm"
                    className="shrink-0 bg-violet-600 text-white hover:bg-violet-500"
                    aria-label="Send message"
                    disabled={!text.trim()}
                >
                    <SendHorizontal className="size-4" />
                </Button>
            </div>
        </form>
    );
}
