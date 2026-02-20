"use client";

import { Mic, SendHorizontal, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function InputBar() {
    return (
        <div className="shrink-0 border-t border-white/5 px-4 py-3">
            <div className="mx-auto flex w-full max-w-2xl items-center gap-2">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-zinc-400 hover:text-violet-400"
                    aria-label="Voice input"
                >
                    <Mic className="size-4" />
                </Button>

                <Input
                    placeholder="Type a message…"
                    className="flex-1 border-white/10 bg-white/5 placeholder:text-zinc-600 focus-visible:border-violet-500/50 focus-visible:ring-violet-500/20"
                />

                <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-zinc-400 hover:text-violet-400"
                    aria-label="Send image"
                >
                    <ImagePlus className="size-4" />
                </Button>

                <Button
                    size="icon-sm"
                    className="shrink-0 bg-violet-600 text-white hover:bg-violet-500"
                    aria-label="Send message"
                >
                    <SendHorizontal className="size-4" />
                </Button>
            </div>
        </div>
    );
}
