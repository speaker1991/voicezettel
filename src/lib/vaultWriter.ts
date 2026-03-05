import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { logger } from "@/lib/logger";

const OBSIDIAN_REST_URL = process.env.OBSIDIAN_REST_URL;
const OBSIDIAN_API_KEY = process.env.OBSIDIAN_API_KEY;
const VAULT_PATH = process.env.VAULT_PATH;

interface WriteResult {
    success: boolean;
    error?: string;
    method: string;
}

/**
 * Write a note to Obsidian vault.
 * Tries filesystem first, then REST API fallback.
 */
export async function writeNoteToVault(
    title: string,
    content: string,
    folder: string = "Zettelkasten",
): Promise<WriteResult> {
    const filename = `${title}.md`;

    // Method 1: Direct filesystem write
    if (VAULT_PATH) {
        try {
            const targetDir = join(VAULT_PATH, folder);
            await mkdir(targetDir, { recursive: true });
            const filePath = join(targetDir, filename);
            await writeFile(filePath, content, "utf-8");
            return { success: true, method: "filesystem" };
        } catch (err) {
            const fsErr = err instanceof Error ? err.message : "Unknown";
            // Try REST API as fallback
            if (OBSIDIAN_REST_URL && OBSIDIAN_API_KEY) {
                const restResult = await writeViaRestApi(
                    `${folder}/${filename}`,
                    content,
                );
                if (restResult.success) return restResult;
            }
            return { success: false, error: fsErr, method: "filesystem" };
        }
    }

    // Method 2: REST API
    if (OBSIDIAN_REST_URL && OBSIDIAN_API_KEY) {
        return writeViaRestApi(`${folder}/${filename}`, content);
    }

    return {
        success: false,
        error: "No VAULT_PATH or OBSIDIAN_REST_URL configured",
        method: "none",
    };
}

async function writeViaRestApi(
    path: string,
    content: string,
): Promise<WriteResult> {
    const url = `${OBSIDIAN_REST_URL}/vault/${encodeURIComponent(path)}`;

    try {
        const res = await fetch(url, {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${OBSIDIAN_API_KEY}`,
                "Content-Type": "text/markdown",
            },
            body: content,
        });

        if (!res.ok) {
            const errText = await res.text();
            return { success: false, error: errText, method: "rest-api" };
        }

        return { success: true, method: "rest-api" };
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown";
        logger.error(`REST API write error: ${msg}`);
        return { success: false, error: msg, method: "rest-api" };
    }
}
