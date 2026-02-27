"use client";

import { useCallback } from "react";
import {
    LayoutDashboard,
    ScrollText,
    BrainCircuit,
    Mic,
    Settings,
    Menu,
    X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAdminStore } from "@/stores/adminStore";
import type { AdminTab } from "@/types/admin";

const NAV_ITEMS: Array<{
    tab: AdminTab;
    label: string;
    icon: React.ElementType;
}> = [
        { tab: "dashboard", label: "Дашборд", icon: LayoutDashboard },
        { tab: "logs", label: "Логи", icon: ScrollText },
        { tab: "prompts", label: "Промпты", icon: BrainCircuit },
        { tab: "sessions", label: "Сессии", icon: Mic },
        { tab: "settings", label: "Настройки", icon: Settings },
    ];

export function AdminSidebar() {
    const activeTab = useAdminStore((s) => s.activeTab);
    const sidebarOpen = useAdminStore((s) => s.sidebarOpen);
    const setActiveTab = useAdminStore((s) => s.setActiveTab);
    const toggleSidebar = useAdminStore((s) => s.toggleSidebar);

    const handleNav = useCallback(
        (tab: AdminTab) => {
            setActiveTab(tab);
        },
        [setActiveTab],
    );

    return (
        <>
            {/* Mobile hamburger */}
            <button
                type="button"
                onClick={toggleSidebar}
                className="fixed left-3 top-3 z-50 rounded-lg border border-zinc-800 bg-zinc-900/90 p-2 text-zinc-400 backdrop-blur-sm md:hidden"
                aria-label="Toggle menu"
            >
                {sidebarOpen ? (
                    <X className="size-5" />
                ) : (
                    <Menu className="size-5" />
                )}
            </button>

            {/* Overlay on mobile */}
            <AnimatePresence>
                {sidebarOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
                        onClick={toggleSidebar}
                    />
                )}
            </AnimatePresence>

            {/* Sidebar — fixed on mobile, static on desktop */}
            <aside
                className={`fixed inset-y-0 left-0 z-40 flex w-[220px] flex-col border-r border-white/5 bg-zinc-950 transition-transform duration-200 md:relative md:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"
                    }`}
            >
                {/* Logo */}
                <div className="flex h-14 items-center gap-1 border-b border-white/5 px-5">
                    <span className="text-base font-bold text-zinc-100">
                        Voice
                    </span>
                    <span className="bg-gradient-to-r from-violet-500 to-cyan-400 bg-clip-text text-base font-light text-transparent">
                        Zettel
                    </span>
                    <span className="ml-2 rounded-md bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-violet-400">
                        ADMIN
                    </span>
                </div>

                {/* Navigation */}
                <nav className="flex-1 space-y-1 overflow-y-auto p-2">
                    {NAV_ITEMS.map((item) => {
                        const isActive = activeTab === item.tab;
                        return (
                            <button
                                key={item.tab}
                                type="button"
                                onClick={() => handleNav(item.tab)}
                                className={`flex w-full items-center gap-2.5 rounded-xl border-l-[3px] px-3 py-2.5 text-left text-[13px] font-medium transition-all ${isActive
                                        ? "border-l-violet-500 bg-violet-500/10 text-zinc-100"
                                        : "border-l-transparent text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
                                    }`}
                            >
                                <div
                                    className={`flex size-7 items-center justify-center rounded-lg transition-all ${isActive
                                            ? "bg-violet-500/20 shadow-[0_0_8px_rgba(139,92,246,0.3)]"
                                            : "bg-white/[0.04]"
                                        }`}
                                >
                                    <item.icon
                                        className={`size-3.5 transition-colors ${isActive
                                                ? "text-violet-400"
                                                : "text-zinc-500"
                                            }`}
                                    />
                                </div>
                                {item.label}
                            </button>
                        );
                    })}
                </nav>

                {/* Footer */}
                <div className="border-t border-white/5 p-3">
                    <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2">
                        <div className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
                            Статус
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                            <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
                            Online
                        </div>
                    </div>
                </div>
            </aside>
        </>
    );
}
