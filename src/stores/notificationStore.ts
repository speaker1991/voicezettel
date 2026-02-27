import { create } from "zustand";
import type {
    AppNotification,
    NotificationLevel,
} from "@/types/notification";

interface NotificationState {
    notifications: AppNotification[];
    unreadCount: number;
}

interface NotificationActions {
    addNotification: (message: string, level: NotificationLevel) => void;
    markAllRead: () => void;
    clearAll: () => void;
    removeNotification: (id: string) => void;
}

export const useNotificationStore = create<
    NotificationState & NotificationActions
>()((set) => ({
    notifications: [],
    unreadCount: 0,

    addNotification: (message, level) =>
        set((state) => {
            const notification: AppNotification = {
                id: crypto.randomUUID(),
                message,
                level,
                timestamp: new Date().toISOString(),
                read: false,
            };
            return {
                notifications: [notification, ...state.notifications].slice(
                    0,
                    50,
                ),
                unreadCount: state.unreadCount + 1,
            };
        }),

    markAllRead: () =>
        set((state) => ({
            notifications: state.notifications.map((n) => ({
                ...n,
                read: true,
            })),
            unreadCount: 0,
        })),

    clearAll: () => set({ notifications: [], unreadCount: 0 }),

    removeNotification: (id) =>
        set((state) => {
            const target = state.notifications.find((n) => n.id === id);
            return {
                notifications: state.notifications.filter(
                    (n) => n.id !== id,
                ),
                unreadCount:
                    target && !target.read
                        ? state.unreadCount - 1
                        : state.unreadCount,
            };
        }),
}));
