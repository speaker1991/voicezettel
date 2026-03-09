"use client";

import { useEffect } from "react";
import { useUser } from "@/components/providers/UserProvider";
import { installGlobalErrorHandlers } from "@/lib/remoteLogger";

/**
 * Invisible component that installs global error handlers.
 * Must be rendered inside UserProvider.
 */
export function GlobalErrorLogger() {
    const { userId } = useUser();

    useEffect(() => {
        if (!userId) return;
        const cleanup = installGlobalErrorHandlers(userId);
        return cleanup;
    }, [userId]);

    return null;
}
