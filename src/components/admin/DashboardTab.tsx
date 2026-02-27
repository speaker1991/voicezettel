"use client";

import { Lightbulb, Heart, Users, ListChecks } from "lucide-react";
import { useCountersStore } from "@/stores/countersStore";
import { useChatStore } from "@/stores/chatStore";
import type { ServiceEntry, ActivityItem } from "@/types/admin";

// ── Mock services (will be real later) ───────────────────────
const SERVICES: ServiceEntry[] = [
    { name: "OpenAI Realtime", status: "online", latency: "124ms", uptime: "99.9%" },
    { name: "Whisper STT", status: "online", latency: "340ms", uptime: "99.7%" },
    { name: "Next.js Server", status: "online", latency: "12ms", uptime: "100%" },
    { name: "Cloudflare Tunnel", status: "online", latency: "8ms", uptime: "99.8%" },
    { name: "Obsidian Sync", status: "offline", latency: "—", uptime: "0%" },
];

const ACTIVITY: ActivityItem[] = [
    { id: "1", icon: "🎤", title: "Голосовая сессия", desc: "Длительность: 2 мин 14 сек", time: "2 мин" },
    { id: "2", icon: "📝", title: "Создана заметка", desc: "Идея по проекту VoiceZettel", time: "5 мин" },
    { id: "3", icon: "🔐", title: "Авторизация", desc: "Google OAuth — успешно", time: "12 мин" },
    { id: "4", icon: "🎙", title: "Режим петлички", desc: "Встреча: 15 мин, 23 реплики", time: "1ч" },
];

const STATUS_COLORS = {
    online: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    degraded: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    offline: "border-red-500/30 bg-red-500/10 text-red-400",
} as const;

const STATUS_DOT = {
    online: "bg-emerald-400",
    degraded: "bg-amber-400",
    offline: "bg-red-400",
} as const;

export function DashboardTab() {
    // Real data from stores
    const ideas = useCountersStore((s) => s.ideas);
    const facts = useCountersStore((s) => s.facts);
    const persons = useCountersStore((s) => s.persons);
    const tasks = useCountersStore((s) => s.tasks);
    const tokensUsd = useCountersStore((s) => s.tokensUsd);
    const tokensBalance = useCountersStore((s) => s.tokensBalance);
    const messagesCount = useChatStore((s) => s.messages.length);

    const totalNotes = ideas + facts + persons + tasks;

    const kpis = [
        {
            icon: "📝",
            label: "ЗАМЕТКИ",
            value: String(totalNotes),
            sub: (
                <span className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-0.5"><Lightbulb className="inline size-3 text-violet-400" />{ideas}</span>
                    <span className="inline-flex items-center gap-0.5"><Heart className="inline size-3 text-violet-400" />{facts}</span>
                    <span className="inline-flex items-center gap-0.5"><Users className="inline size-3 text-violet-400" />{persons}</span>
                    <span className="inline-flex items-center gap-0.5"><ListChecks className="inline size-3 text-violet-400" />{tasks}</span>
                </span>
            ),
            color: "text-violet-400",
        },
        {
            icon: "💬",
            label: "СООБЩЕНИЙ",
            value: String(messagesCount),
            sub: "в текущей сессии",
            color: "text-cyan-400",
        },
        {
            icon: "🪙",
            label: "ТОКЕНЫ",
            value: tokensBalance.toLocaleString(),
            sub: `использовано`,
            color: "text-amber-400",
            progress: Math.min(tokensBalance / 10000, 1) * 100,
        },
        {
            icon: "💰",
            label: "РАСХОД ($)",
            value: `$${tokensUsd.toFixed(2)}`,
            sub: `≈ прогноз $${(tokensUsd * 30).toFixed(2)}/мес`,
            color: "text-emerald-400",
        },
    ];

    return (
        <div className="space-y-3">
            {/* KPI Grid — 2 cols on mobile, 4 on desktop */}
            <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
                {kpis.map((kpi) => (
                    <div
                        key={kpi.label}
                        className="rounded-xl border border-violet-500/15 bg-zinc-900/60 p-3 backdrop-blur-md sm:rounded-2xl sm:p-4"
                    >
                        <div className="mb-1 text-lg sm:mb-2 sm:text-xl">{kpi.icon}</div>
                        <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-500 sm:text-[10px]">
                            {kpi.label}
                        </div>
                        <div className={`mb-0.5 text-xl font-bold tracking-tight sm:text-2xl ${kpi.color}`}>
                            {kpi.value}
                        </div>
                        <div className="text-[10px] text-zinc-600 sm:text-[11px]">
                            {kpi.sub}
                        </div>
                        {kpi.progress !== undefined && (
                            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/5">
                                <div
                                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all"
                                    style={{ width: `${kpi.progress}%` }}
                                />
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Services + Activity — stacked on mobile, 2-col on desktop */}
            <div className="grid gap-2 sm:gap-3 lg:grid-cols-2">
                {/* Service Table */}
                <div className="rounded-xl border border-violet-500/15 bg-zinc-900/60 p-3 backdrop-blur-md sm:rounded-2xl sm:p-4">
                    <div className="mb-2 flex items-center justify-between sm:mb-3">
                        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 sm:text-[11px]">
                            Сервисы
                        </h3>
                        <div className="flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-medium text-emerald-400 sm:text-[10px]">
                            <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
                            4/5
                        </div>
                    </div>

                    {/* Mobile: cards, Desktop: table */}
                    <div className="space-y-1.5 sm:hidden">
                        {SERVICES.map((svc) => (
                            <div key={svc.name} className="flex items-center justify-between rounded-lg bg-white/[0.02] px-2.5 py-2">
                                <span className="text-[11px] font-medium text-zinc-300">{svc.name}</span>
                                <span className={`rounded-full border px-1.5 py-px text-[9px] font-medium ${STATUS_COLORS[svc.status]}`}>
                                    {svc.status}
                                </span>
                            </div>
                        ))}
                    </div>
                    <table className="hidden w-full sm:table">
                        <thead>
                            <tr className="border-b border-white/5">
                                <th className="pb-2 text-left text-[10px] font-semibold uppercase text-zinc-600">Сервис</th>
                                <th className="pb-2 text-left text-[10px] font-semibold uppercase text-zinc-600">Статус</th>
                                <th className="pb-2 text-left text-[10px] font-semibold uppercase text-zinc-600">Пинг</th>
                                <th className="pb-2 text-right text-[10px] font-semibold uppercase text-zinc-600">Аптайм</th>
                            </tr>
                        </thead>
                        <tbody>
                            {SERVICES.map((svc) => (
                                <tr key={svc.name} className="border-b border-white/[0.03] transition-colors hover:bg-white/[0.02]">
                                    <td className="py-2 text-xs font-medium text-zinc-300">{svc.name}</td>
                                    <td className="py-2">
                                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[svc.status]}`}>
                                            <span className={`size-1 rounded-full ${STATUS_DOT[svc.status]}`} />
                                            {svc.status}
                                        </span>
                                    </td>
                                    <td className="py-2 font-mono text-[11px] text-zinc-500">{svc.latency}</td>
                                    <td className="py-2 text-right text-[11px] text-zinc-500">{svc.uptime}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Activity Feed */}
                <div className="rounded-xl border border-violet-500/15 bg-zinc-900/60 p-3 backdrop-blur-md sm:rounded-2xl sm:p-4">
                    <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 sm:mb-3 sm:text-[11px]">
                        Активность
                    </h3>
                    <div className="space-y-0">
                        {ACTIVITY.map((item) => (
                            <div key={item.id} className="flex items-start gap-2 border-b border-white/[0.03] py-2 last:border-b-0">
                                <span className="mt-0.5 text-sm">{item.icon}</span>
                                <div className="min-w-0 flex-1">
                                    <div className="text-[11px] font-medium text-zinc-300 sm:text-xs">{item.title}</div>
                                    <div className="truncate text-[10px] text-zinc-600 sm:text-[11px]">{item.desc}</div>
                                </div>
                                <span className="shrink-0 font-mono text-[9px] text-zinc-600 sm:text-[10px]">{item.time}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Session bars */}
            <div className="rounded-xl border border-violet-500/15 bg-zinc-900/60 p-3 backdrop-blur-md sm:rounded-2xl sm:p-4">
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 sm:mb-3 sm:text-[11px]">
                    Сессии за неделю
                </h3>
                <div className="flex items-end gap-1.5" style={{ height: 60 }}>
                    {[
                        { day: "Пн", h: 30 },
                        { day: "Вт", h: 55 },
                        { day: "Ср", h: 20 },
                        { day: "Чт", h: 75 },
                        { day: "Пт", h: 45 },
                        { day: "Сб", h: 10 },
                        { day: "Вс", h: 60 },
                    ].map((d) => (
                        <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                            <div
                                className="w-full rounded-t bg-gradient-to-t from-violet-500/40 to-violet-500"
                                style={{ height: `${d.h}%` }}
                            />
                            <span className="text-[8px] text-zinc-600 sm:text-[9px]">{d.day}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
