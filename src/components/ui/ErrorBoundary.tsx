"use client";

import React, { Component, type ReactNode } from "react";
import { motion } from "framer-motion";
import { logger } from "@/lib/logger";

interface ErrorBoundaryProps {
    children: ReactNode;
    /** Label shown in the fallback UI (e.g. "Голосовой модуль") */
    label?: string;
    /** Optional custom fallback component */
    fallback?: ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

/**
 * Catches unhandled errors in child components and renders
 * a compact, styled fallback instead of crashing the entire page.
 *
 * Usage:
 * ```tsx
 * <ErrorBoundary label="Голосовой модуль">
 *   <OrbArea />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
        logger.error(
            `[ErrorBoundary:${this.props.label ?? "unknown"}]`,
            error.message,
            errorInfo.componentStack ?? "",
        );
    }

    private handleRetry = (): void => {
        this.setState({ hasError: false, error: null });
    };

    render(): ReactNode {
        if (!this.state.hasError) {
            return this.props.children;
        }

        if (this.props.fallback) {
            return this.props.fallback;
        }

        return (
            <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mx-auto my-4 flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-red-500/20 bg-red-950/30 p-6 text-center backdrop-blur-sm"
            >
                <div className="text-2xl">⚠️</div>
                <p className="text-sm font-medium text-red-300">
                    {this.props.label
                        ? `Ошибка в «${this.props.label}»`
                        : "Произошла ошибка"}
                </p>
                <p className="text-xs text-zinc-500 max-w-[280px] truncate">
                    {this.state.error?.message ?? "Неизвестная ошибка"}
                </p>
                <button
                    onClick={this.handleRetry}
                    className="mt-1 rounded-lg bg-violet-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-500"
                >
                    Попробовать снова
                </button>
            </motion.div>
        );
    }
}
