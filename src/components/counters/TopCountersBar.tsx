"use client";

import { Lightbulb, Heart, Users, ListChecks } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useCountersStore } from "@/stores/countersStore";
import { useSettingsStore } from "@/stores/settingsStore";

interface BadgeConfig {
    key: string;
    label: string;
    icon: React.ElementType;
    getValue: () => number;
    showFlag: boolean;
}

function CounterBadge({
    icon: Icon,
    value,
    label,
    badgeKey,
}: {
    icon: React.ElementType;
    value: number;
    label: string;
    badgeKey: string;
}) {
    return (
        <motion.div
            layout
            data-counter-type={badgeKey}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col items-center gap-0.5"
        >
            {/* Pill: icon + number */}
            <div className="flex h-7 items-center gap-1 rounded-full bg-zinc-800/80 px-2.5">
                <Icon className="size-3 text-violet-400" />
                <span className="text-xs font-semibold leading-none text-zinc-100">
                    {value}
                </span>
            </div>
            {/* Label below */}
            <span className="text-xs leading-none text-zinc-500">
                {label}
            </span>
        </motion.div>
    );
}

function TokenDisplay({
    usd,
    rub,
    balance,
    showUsd,
    showRub,
    showBalance,
}: {
    usd: number;
    rub: number;
    balance: number;
    showUsd: boolean;
    showRub: boolean;
    showBalance: boolean;
}) {
    if (!showUsd && !showRub && !showBalance) return null;

    const parts: string[] = [];
    if (showUsd) parts.push(`$ ${usd.toFixed(2)}`);
    if (showRub) parts.push(`₽ ${rub.toFixed(2)}`);
    if (showBalance) parts.push(`${balance} tok`);

    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col items-end gap-0.5"
        >
            {/* Pill: token values */}
            <div className="flex h-7 items-center rounded-full bg-zinc-800/80 px-2.5">
                <span className="text-xs font-medium leading-none text-zinc-300">
                    {parts.join(" / ")}
                </span>
            </div>
            {/* Label below */}
            <span className="text-xs leading-none text-zinc-500">
                Токены (live count)
            </span>
        </motion.div>
    );
}

export function TopCountersBar() {
    const { ideas, facts, persons, tasks, tokensUsd, tokensRub, tokensBalance } =
        useCountersStore();
    const {
        showIdeasCounter,
        showFactsCounter,
        showPersonsCounter,
        showTasksCounter,
        showUsdTokens,
        showRubTokens,
        showTokenBalance,
    } = useSettingsStore();

    const badges: BadgeConfig[] = [
        {
            key: "ideas",
            label: "Ideas",
            icon: Lightbulb,
            getValue: () => ideas,
            showFlag: showIdeasCounter,
        },
        {
            key: "facts",
            label: "Facts",
            icon: Heart,
            getValue: () => facts,
            showFlag: showFactsCounter,
        },
        {
            key: "persons",
            label: "Persons",
            icon: Users,
            getValue: () => persons,
            showFlag: showPersonsCounter,
        },
        {
            key: "tasks",
            label: "Tasks",
            icon: ListChecks,
            getValue: () => tasks,
            showFlag: showTasksCounter,
        },
    ];

    const visibleBadges = badges.filter((b) => b.showFlag);
    const hasTokens = showUsdTokens || showRubTokens || showTokenBalance;

    if (visibleBadges.length === 0 && !hasTokens) return null;

    return (
        <div className="flex shrink-0 items-start justify-between gap-2 overflow-x-auto py-2 scrollbar-none">
            {/* Left: counter badges */}
            <div className="flex items-start gap-2">
                <AnimatePresence mode="popLayout">
                    {visibleBadges.map((badge) => (
                        <CounterBadge
                            key={badge.key}
                            badgeKey={badge.key}
                            icon={badge.icon}
                            value={badge.getValue()}
                            label={badge.label}
                        />
                    ))}
                </AnimatePresence>
            </div>

            {/* Right: tokens */}
            <AnimatePresence>
                {hasTokens && (
                    <TokenDisplay
                        usd={tokensUsd}
                        rub={tokensRub}
                        balance={tokensBalance}
                        showUsd={showUsdTokens}
                        showRub={showRubTokens}
                        showBalance={showTokenBalance}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
