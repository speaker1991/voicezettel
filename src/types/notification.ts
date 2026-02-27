import { z } from "zod";

export const NotificationLevelSchema = z.enum(["info", "warning", "error"]);
export type NotificationLevel = z.infer<typeof NotificationLevelSchema>;

export interface AppNotification {
    id: string;
    message: string;
    level: NotificationLevel;
    timestamp: string;
    read: boolean;
}
