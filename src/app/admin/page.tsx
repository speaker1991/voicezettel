"use client";

import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { DashboardTab } from "@/components/admin/DashboardTab";
import { LogsTab } from "@/components/admin/LogsTab";
import { PromptsTab } from "@/components/admin/PromptsTab";
import { useAdminStore } from "@/stores/adminStore";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

const TAB_TITLES: Record<string, string> = {
    dashboard: "📊 Дашборд",
    logs: "📋 Логи",
    prompts: "🧠 Промпты",
    sessions: "🎤 Сессии",
    settings: "⚙️ Настройки",
};

export default function AdminPage() {
    const activeTab = useAdminStore((s) => s.activeTab);

    return (
        <div className="flex h-dvh overflow-hidden bg-zinc-950 text-zinc-100">
            {/* Sidebar — hidden on mobile, visible on desktop */}
            <AdminSidebar />

            {/* Main content — always full width on mobile */}
            <div className="flex min-w-0 flex-1 flex-col">
                {/* Top bar */}
                <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/5 bg-zinc-950/90 px-4 backdrop-blur-xl">
                    {/* Spacer for mobile hamburger */}
                    <div className="w-9 md:hidden" />

                    <h1 className="text-sm font-semibold text-zinc-200">
                        {TAB_TITLES[activeTab]}
                    </h1>

                    <div className="flex-1" />

                    {/* Metrics — hidden on small mobile */}
                    <div className="hidden items-center gap-2 sm:flex">
                        <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-1 text-[11px]">
                            <span className="text-zinc-600">RAM</span>
                            <span className="font-medium text-zinc-400">2.1 GB</span>
                        </div>
                        <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-1 text-[11px]">
                            <span className="text-zinc-600">CPU</span>
                            <span className="font-medium text-zinc-400">8%</span>
                        </div>
                    </div>

                    <Link
                        href="/"
                        className="flex items-center gap-1 rounded-lg border border-violet-500/20 bg-violet-500/5 px-2.5 py-1.5 text-[11px] text-violet-400 transition-all hover:bg-violet-500/10 hover:shadow-[0_0_10px_rgba(139,92,246,0.15)]"
                    >
                        <ArrowLeft className="size-3" />
                        <span className="hidden sm:inline">Назад</span>
                    </Link>
                </header>

                {/* Tab content */}
                <main className="flex-1 overflow-y-auto p-3 sm:p-4">
                    {activeTab === "dashboard" && <DashboardTab />}
                    {activeTab === "logs" && <LogsTab />}
                    {activeTab === "prompts" && <PromptsTab />}
                    {activeTab === "sessions" && (
                        <div className="flex h-40 items-center justify-center rounded-xl border border-violet-500/15 bg-zinc-900/60 text-sm text-zinc-500">
                            🎤 Сессии — скоро
                        </div>
                    )}
                    {activeTab === "settings" && (
                        <div className="flex h-40 items-center justify-center rounded-xl border border-violet-500/15 bg-zinc-900/60 text-sm text-zinc-500">
                            ⚙️ Настройки — скоро
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}
