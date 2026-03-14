/**
 * @module api/yandex-stt-token
 * Proxy for Yandex IAM token — prevents exposing OAuth token to client.
 */
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

const YANDEX_IAM_URL = "https://iam.api.cloud.yandex.net/iam/v1/tokens";

let cachedIamToken: string | null = null;
let iamTokenExpiry = 0;
const IAM_TOKEN_TTL_MS = 11 * 60 * 60 * 1000; // 11 hours

export async function GET() {
    try {
        if (cachedIamToken && Date.now() < iamTokenExpiry) {
            return NextResponse.json({ iamToken: cachedIamToken });
        }

        const oauthToken = process.env.YANDEX_OAUTH_TOKEN;
        const folderId = process.env.YANDEX_SPEECHKIT_FOLDER_ID;

        if (!oauthToken || !folderId) {
            return NextResponse.json(
                { error: "YANDEX_OAUTH_TOKEN or YANDEX_SPEECHKIT_FOLDER_ID not configured" },
                { status: 500 },
            );
        }

        const res = await fetch(YANDEX_IAM_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ yandexPassportOauthToken: oauthToken }),
        });

        if (!res.ok) {
            const text = await res.text();
            logger.error("Yandex IAM token error:", res.status, text);
            return NextResponse.json({ error: `IAM error: ${res.status}` }, { status: 502 });
        }

        const data = (await res.json()) as { iamToken: string };
        cachedIamToken = data.iamToken;
        iamTokenExpiry = Date.now() + IAM_TOKEN_TTL_MS;

        return NextResponse.json({ iamToken: data.iamToken, folderId });
    } catch (err) {
        logger.error("Yandex IAM token error:", (err as Error).message);
        return NextResponse.json({ error: "Token fetch failed" }, { status: 500 });
    }
}
