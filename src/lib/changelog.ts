import type { NotificationLevel } from "@/types/notification";

export interface ChangelogEntry {
    id: string;
    message: string;
    level: NotificationLevel;
    date: string;
}

/**
 * Changelog — добавляйте новые записи СВЕРХУ.
 * id должен быть уникальным (используется для отслеживания прочитанных).
 */
export const CHANGELOG: ChangelogEntry[] = [
    {
        id: "lavalier-mode-2026-02-27",
        message: "🎙 Режим петлички — свайпни шар влево, ИИ слушает встречу и делает протокол",
        level: "info",
        date: "2026-02-27",
    },
    {
        id: "attach-files-2026-02-27",
        message: "🆕 Добавлена функция прикрепления файлов (фото, документы, аудио) к чату",
        level: "info",
        date: "2026-02-27",
    },
    {
        id: "ai-log-analysis-2026-02-27",
        message: "🤖 В настройках появилась кнопка «Анализ ИИ» — ИИ проверит логи за вас",
        level: "info",
        date: "2026-02-27",
    },
    {
        id: "google-auth-2026-02-27",
        message: "🔐 Добавлена авторизация через Google-аккаунт",
        level: "info",
        date: "2026-02-27",
    },
    {
        id: "notification-bell-2026-02-26",
        message: "🔔 Уведомления теперь в колокольчике в шапке",
        level: "info",
        date: "2026-02-26",
    },
    {
        id: "counter-sound-2026-02-26",
        message: "🔊 Добавлен звук при обновлении счётчиков",
        level: "info",
        date: "2026-02-26",
    },
];
