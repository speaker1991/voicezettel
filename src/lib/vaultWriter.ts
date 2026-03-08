import { writeFile, mkdir, appendFile, access } from "fs/promises";
import { join } from "path";
import { logger } from "@/lib/logger";

const VAULT_PATH = process.env.VAULT_PATH;

interface WriteResult {
    success: boolean;
    error?: string;
    method: string;
}

/**
 * Sanitize userId for safe filesystem paths.
 * Replaces dangerous characters, keeps email-like names readable.
 */
function sanitizeUserId(userId: string): string {
    return userId.replace(/[<>:"/\\|?*]/g, "_").slice(0, 100);
}

/**
 * Get the user's base directory inside the vault.
 */
function getUserVaultDir(userId: string): string {
    if (!VAULT_PATH) throw new Error("VAULT_PATH not configured");
    return join(VAULT_PATH, sanitizeUserId(userId));
}

/**
 * Write a Zettelkasten note to user's vault subdirectory.
 * Path: VAULT_PATH/<userId>/<folder>/<title>.md
 */
export async function writeNoteToVault(
    userId: string,
    title: string,
    content: string,
    folder: string = "Zettelkasten",
): Promise<WriteResult> {
    if (!VAULT_PATH) {
        return { success: false, error: "VAULT_PATH not configured", method: "none" };
    }

    const filename = `${title}.md`;

    try {
        const targetDir = join(getUserVaultDir(userId), folder);
        await mkdir(targetDir, { recursive: true });
        const filePath = join(targetDir, filename);
        await writeFile(filePath, content, "utf-8");
        logger.info(`Vault write [${userId}]: ${folder}/${filename}`);
        return { success: true, method: "filesystem" };
    } catch (err) {
        const fsErr = err instanceof Error ? err.message : "Unknown";
        return { success: false, error: fsErr, method: "filesystem" };
    }
}

/**
 * Append a dialog entry to user's Archive folder.
 * Path: VAULT_PATH/<userId>/Archive/YYYY-MM-DD.md
 */
export async function appendToSessionArchive(
    userId: string,
    userText: string,
    assistantText: string,
): Promise<void> {
    if (!VAULT_PATH) return;

    const now = new Date();
    const today = now.toISOString().split("T")[0]; // YYYY-MM-DD
    const time = now.toTimeString().slice(0, 8);    // HH:MM:SS

    const archiveDir = join(getUserVaultDir(userId), "Archive");
    await mkdir(archiveDir, { recursive: true });

    const filePath = join(archiveDir, `${today}.md`);

    const entry = `\n---\n**${time}**\n\n🗣 **Пользователь:** ${userText}\n\n🤖 **Ассистент:** ${assistantText}\n`;

    try {
        try {
            await access(filePath);
            // File exists — append
            await appendFile(filePath, entry, "utf-8");
        } catch {
            // File doesn't exist — create with header
            const header = `# 📅 Сессия ${today}\n\nАрхив диалогов VoiceZettel за ${today}.\n\nТеги: #archive #session\n`;
            await writeFile(filePath, header + entry, "utf-8");
        }
    } catch {
        // Silent fail — archive is best-effort
    }
}
