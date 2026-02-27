"use client";

import { useRef, useEffect, useMemo, useCallback } from "react";
import { Search } from "lucide-react";
import { useAdminStore } from "@/stores/adminStore";
import type { LogLevel } from "@/types/admin";

const LEVEL_STYLES = {
    INFO: "border-l-transparent",
    WARN: "border-l-amber-500 bg-amber-500/[0.03]",
    ERROR: "border-l-red-500 bg-red-500/[0.03]",
} as const;

const LEVEL_TEXT = {
    INFO: "text-zinc-500",
    WARN: "text-amber-400",
    ERROR: "text-red-400",
} as const;

const FILTER_BTNS: Array<{ level: LogLevel | "ALL"; label: string }> = [
    { level: "ALL", label: "All" },
    { level: "INFO", label: "INFO" },
    { level: "WARN", label: "WARN" },
    { level: "ERROR", label: "ERR" },
];

// Generate demo logs
function generateDemoLogs() {
    const sources = ["voice", "auth", "api", "tunnel", "ssr"];
    const msgs = {
        INFO: [
            "Session started for user",
            "Token refreshed successfully",
            "WebRTC connection established",
            "Page rendered in 42ms",
            "Cloudflare tunnel healthy",
        ],
        WARN: [
            "High latency detected: 520ms",
            "Rate limit approaching: 80%",
            "Session reconnecting...",
        ],
        ERROR: [
            "WebSocket disconnected unexpectedly",
            "OAuth token expired",
            "API timeout after 30s",
        ],
    };

    const levels: LogLevel[] = ["INFO", "INFO", "INFO", "INFO", "WARN", "ERROR"];
    const now = Date.now();

    return Array.from({ length: 30 }, (_, i) => {
        const level = levels[i % levels.length];
        const pool = msgs[level];
        return {
            id: `log-${i}`,
            time: new Date(now - (30 - i) * 60000).toLocaleTimeString("ru-RU"),
            level,
            source: sources[i % sources.length],
            message: pool[i % pool.length],
        };
    });
}

export function LogsTab() {
    const logs = useAdminStore((s) => s.logs);
    const logFilter = useAdminStore((s) => s.logFilter);
    const logSearch = useAdminStore((s) => s.logSearch);
    const autoScroll = useAdminStore((s) => s.autoScroll);
    const setLogFilter = useAdminStore((s) => s.setLogFilter);
    const setLogSearch = useAdminStore((s) => s.setLogSearch);
    const setAutoScroll = useAdminStore((s) => s.setAutoScroll);
    const addLog = useAdminStore((s) => s.addLog);

    const scrollRef = useRef<HTMLDivElement>(null);

    // Seed demo logs on first render
    useEffect(() => {
        if (logs.length > 0) return;
        const demo = generateDemoLogs();
        for (const log of demo) addLog(log);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Auto-scroll
    useEffect(() => {
        if (autoScroll && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs, autoScroll]);

    const filtered = useMemo(() => {
        let result = logs;
        if (logFilter !== "ALL") {
            result = result.filter((l) => l.level === logFilter);
        }
        if (logSearch) {
            const q = logSearch.toLowerCase();
            result = result.filter(
                (l) =>
                    l.message.toLowerCase().includes(q) ||
                    l.source.toLowerCase().includes(q),
            );
        }
        return result;
    }, [logs, logFilter, logSearch]);

    const getFilterStyle = useCallback(
        (level: LogLevel | "ALL") => {
            if (logFilter !== level)
                return "border-white/5 bg-transparent text-zinc-600 hover:bg-white/5 hover:text-zinc-400";
            switch (level) {
                case "ALL":
                    return "border-white/10 bg-white/5 text-zinc-200";
                case "INFO":
                    return "border-zinc-500/25 bg-zinc-500/10 text-zinc-400";
                case "WARN":
                    return "border-amber-500/25 bg-amber-500/10 text-amber-400";
                case "ERROR":
                    return "border-red-500/25 bg-red-500/10 text-red-400";
            }
        },
        [logFilter],
    );

    return (
        <div className="rounded-2xl border border-violet-500/15 bg-zinc-900/60 p-4 backdrop-blur-md">
            {/* Toolbar */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="relative min-w-[160px] flex-1">
                    <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
                    <input
                        type="text"
                        placeholder="Поиск в логах…"
                        value={logSearch}
                        onChange={(e) => setLogSearch(e.target.value)}
                        className="w-full rounded-lg border border-white/5 bg-white/[0.03] py-1.5 pl-8 pr-3 text-xs text-zinc-300 outline-none transition-colors placeholder:text-zinc-600 focus:border-violet-500/30"
                    />
                </div>
                <div className="flex gap-1">
                    {FILTER_BTNS.map((btn) => (
                        <button
                            key={btn.level}
                            type="button"
                            onClick={() => setLogFilter(btn.level)}
                            className={`rounded-md border px-2.5 py-1 font-mono text-[11px] font-semibold transition-all ${getFilterStyle(btn.level)}`}
                        >
                            {btn.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Log container */}
            <div
                ref={scrollRef}
                className="h-[300px] overflow-y-auto rounded-xl border border-white/[0.04] bg-black/30 py-1 sm:h-[400px]"
            >
                {filtered.map((log) => (
                    <div
                        key={log.id}
                        className={`flex items-baseline gap-2 border-l-[3px] px-2.5 py-1 font-mono text-[11px] transition-colors hover:bg-white/[0.02] ${LEVEL_STYLES[log.level]}`}
                    >
                        <span className="shrink-0 text-[10px] text-zinc-600">
                            {log.time}
                        </span>
                        <span
                            className={`w-9 shrink-0 text-[10px] font-semibold ${LEVEL_TEXT[log.level]}`}
                        >
                            {log.level}
                        </span>
                        <span className="w-11 shrink-0 text-[10px] text-cyan-500/70">
                            {log.source}
                        </span>
                        <span className="text-zinc-400">{log.message}</span>
                    </div>
                ))}

                {filtered.length === 0 && (
                    <div className="flex h-full items-center justify-center text-xs text-zinc-600">
                        Нет логов
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="mt-2 flex items-center justify-between">
                <span className="text-[10px] text-zinc-600">
                    {filtered.length} записей
                </span>
                <label className="flex cursor-pointer items-center gap-2 text-[11px] text-zinc-500">
                    Авто-скролл
                    <div
                        onClick={() => setAutoScroll(!autoScroll)}
                        className={`relative h-4 w-7 rounded-full transition-colors ${autoScroll ? "bg-violet-500/40" : "bg-white/10"}`}
                    >
                        <div
                            className={`absolute top-0.5 size-3 rounded-full transition-all ${autoScroll ? "left-3.5 bg-violet-500" : "left-0.5 bg-zinc-500"}`}
                        />
                    </div>
                </label>
            </div>
        </div>
    );
}
