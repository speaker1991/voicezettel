"use client";

import * as React from "react";
import { Switch as RadixSwitch } from "radix-ui";

import { cn } from "@/lib/utils";

function Switch({
    className,
    ...props
}: React.ComponentProps<typeof RadixSwitch.Root>) {
    return (
        <RadixSwitch.Root
            data-slot="switch"
            className={cn(
                "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
                "disabled:cursor-not-allowed disabled:opacity-50",
                "data-[state=checked]:bg-violet-600 data-[state=unchecked]:bg-zinc-700",
                className,
            )}
            {...props}
        >
            <RadixSwitch.Thumb
                data-slot="switch-thumb"
                className={cn(
                    "pointer-events-none block size-4 rounded-full bg-white shadow-lg ring-0 transition-transform",
                    "data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0",
                )}
            />
        </RadixSwitch.Root>
    );
}

export { Switch };
