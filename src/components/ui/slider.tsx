"use client";

import * as React from "react";
import { Slider as RadixSlider } from "radix-ui";

import { cn } from "@/lib/utils";

function Slider({
    className,
    defaultValue,
    value,
    min = 0,
    max = 100,
    ...props
}: React.ComponentProps<typeof RadixSlider.Root>) {
    return (
        <RadixSlider.Root
            data-slot="slider"
            defaultValue={defaultValue}
            value={value}
            min={min}
            max={max}
            className={cn(
                "relative flex w-full touch-none select-none items-center",
                className,
            )}
            {...props}
        >
            <RadixSlider.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-zinc-700">
                <RadixSlider.Range className="absolute h-full bg-violet-600" />
            </RadixSlider.Track>
            <RadixSlider.Thumb className="block size-4 rounded-full border-2 border-violet-600 bg-white shadow transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:pointer-events-none disabled:opacity-50" />
        </RadixSlider.Root>
    );
}

export { Slider };
