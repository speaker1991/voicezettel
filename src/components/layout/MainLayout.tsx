"use client";

import { OrbArea } from "@/components/orb/OrbArea";
import { ChatSection } from "@/components/chat/ChatSection";
import { TopCountersBar } from "@/components/counters/TopCountersBar";
import { AnimationOverlay } from "@/components/counters/FlyingIcon";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import type { ReactNode } from "react";

interface Props {
    topBar: ReactNode;
}

/**
 * Client-side layout that wraps page sections in Error Boundaries.
 * Each section can fail independently without crashing the whole app.
 */
export function MainLayout({ topBar }: Props) {
    return (
        <div className="flex h-dvh flex-col bg-zinc-950">
            <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col min-h-0 px-4">
                {topBar}

                <ErrorBoundary label="Счётчики">
                    <TopCountersBar />
                </ErrorBoundary>

                <ErrorBoundary label="Голосовой модуль">
                    <OrbArea />
                </ErrorBoundary>

                <ErrorBoundary label="Чат">
                    <ChatSection />
                </ErrorBoundary>
            </div>

            <AnimationOverlay />
        </div>
    );
}
