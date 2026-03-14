"use client";

import { useSettingsStore } from "@/stores/settingsStore";
import { Switch } from "@/components/ui/switch";

function SettingRow({
    label,
    checked,
    onToggle,
}: {
    label: string;
    checked: boolean;
    onToggle: () => void;
}) {
    return (
        <div className="flex items-center justify-between py-2">
            <span className="text-sm text-zinc-300">{label}</span>
            <Switch checked={checked} onCheckedChange={onToggle} />
        </div>
    );
}

export function WidgetsSection() {
    const settings = useSettingsStore();

    return (
        <section className="mb-6">
            <h3 className="mb-2 text-sm font-semibold text-zinc-400">
                Показывать виджеты
            </h3>
            <div className="divide-y divide-white/5">
                <SettingRow label="Токены ($)" checked={settings.showUsdTokens} onToggle={settings.toggleShowUsdTokens} />
                <SettingRow label="Токены (₽)" checked={settings.showRubTokens} onToggle={settings.toggleShowRubTokens} />
                <SettingRow label="Баланс токенов" checked={settings.showTokenBalance} onToggle={settings.toggleShowTokenBalance} />
                <SettingRow label="Счётчик идей" checked={settings.showIdeasCounter} onToggle={settings.toggleShowIdeasCounter} />
                <SettingRow label="Счётчик фактов" checked={settings.showFactsCounter} onToggle={settings.toggleShowFactsCounter} />
                <SettingRow label="Счётчик персон" checked={settings.showPersonsCounter} onToggle={settings.toggleShowPersonsCounter} />
                <SettingRow label="Счётчик задач" checked={settings.showTasksCounter} onToggle={settings.toggleShowTasksCounter} />
            </div>
        </section>
    );
}
