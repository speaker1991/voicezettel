"use client";

import {
    createContext,
    useContext,
    useEffect,
    type ReactNode,
} from "react";
import { useChatStore } from "@/stores/chatStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useChatSync } from "@/hooks/useChatSync";
import { useSettingsSync } from "@/hooks/useSettingsSync";

interface UserContextValue {
    userId: string;
    userName: string;
    userEmail: string;
}

const UserContext = createContext<UserContextValue>({
    userId: "anonymous",
    userName: "",
    userEmail: "",
});

export function useUser() {
    return useContext(UserContext);
}

/**
 * Inner component that activates chat sync after context is available.
 */
function ChatSyncActivator({ children }: { children: ReactNode }) {
    const { userId } = useContext(UserContext);
    useChatSync();
    useSettingsSync(userId);
    return <>{children}</>;
}

/**
 * Provider that scopes localStorage keys by user ID.
 * When user changes, it rehydrates stores with user-specific data.
 */
export function UserProvider({
    userId,
    userName,
    userEmail,
    children,
}: {
    userId: string;
    userName: string;
    userEmail: string;
    children: ReactNode;
}) {
    useEffect(() => {
        try {
            // Rehydrate stores with user-specific keys
            const chatKey = `voicezettel-chat-${userId}`;
            const settingsKey = `voicezettel-settings-${userId}`;

            // Migrate from old non-scoped keys if needed
            const oldChat = localStorage.getItem("voicezettel-chat");
            const oldSettings = localStorage.getItem("voicezettel-settings");

            if (oldChat && !localStorage.getItem(chatKey)) {
                localStorage.setItem(chatKey, oldChat);
                localStorage.removeItem("voicezettel-chat");
            }
            if (oldSettings && !localStorage.getItem(settingsKey)) {
                localStorage.setItem(settingsKey, oldSettings);
                localStorage.removeItem("voicezettel-settings");
            }

            // Update store names to user-scoped keys
            useChatStore.persist.setOptions({ name: chatKey });
            useSettingsStore.persist.setOptions({ name: settingsKey });

            // Force rehydrate from new keys
            void useChatStore.persist.rehydrate();
            void useSettingsStore.persist.rehydrate();
        } catch {
            // localStorage may be unavailable (private browsing, etc.)
        }
    }, [userId]);

    return (
        <UserContext.Provider value={{ userId, userName, userEmail }}>
            <ChatSyncActivator>{children}</ChatSyncActivator>
        </UserContext.Provider>
    );
}
