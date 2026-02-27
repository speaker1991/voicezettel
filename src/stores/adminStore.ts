import { create } from "zustand";
import type { AdminTab, LogEntry, LogLevel } from "@/types/admin";

interface AdminState {
    activeTab: AdminTab;
    sidebarOpen: boolean;
    logs: LogEntry[];
    logFilter: LogLevel | "ALL";
    logSearch: string;
    autoScroll: boolean;
}

interface AdminActions {
    setActiveTab: (tab: AdminTab) => void;
    toggleSidebar: () => void;
    setSidebarOpen: (open: boolean) => void;
    addLog: (entry: LogEntry) => void;
    clearLogs: () => void;
    setLogFilter: (level: LogLevel | "ALL") => void;
    setLogSearch: (search: string) => void;
    setAutoScroll: (val: boolean) => void;
}

export const useAdminStore = create<AdminState & AdminActions>()((set) => ({
    activeTab: "dashboard",
    sidebarOpen: false,
    logs: [],
    logFilter: "ALL",
    logSearch: "",
    autoScroll: true,

    setActiveTab: (activeTab) => set({ activeTab, sidebarOpen: false }),
    toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
    setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
    addLog: (entry) =>
        set((s) => ({ logs: [...s.logs.slice(-199), entry] })),
    clearLogs: () => set({ logs: [] }),
    setLogFilter: (logFilter) => set({ logFilter }),
    setLogSearch: (logSearch) => set({ logSearch }),
    setAutoScroll: (autoScroll) => set({ autoScroll }),
}));
