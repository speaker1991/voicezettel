import { NextRequest } from "next/server";

export const runtime = "nodejs";

const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY ?? "";
const GEMINI_LIVE_MODEL =
    process.env.GEMINI_LIVE_MODEL ?? "gemini-2.0-flash-live-001";

export async function GET(req: NextRequest) {
    // Проверяем WebSocket upgrade
    const upgradeHeader = req.headers.get("upgrade") ?? "";
    if (upgradeHeader.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    if (!GOOGLE_GEMINI_API_KEY) {
        return new Response("GOOGLE_GEMINI_API_KEY not set", { status: 501 });
    }

    const geminiWsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GOOGLE_GEMINI_API_KEY}`;

    // Next.js 14+ App Router поддерживает WebSocket через socket hijack
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { socket: clientSocket, response } = (req as any).socket
        ? await new Promise<{ socket: import("net").Socket; response: Response }>((resolve) => {
            // @ts-expect-error internal Next.js API
            req.socket.server.once("upgrade", (_request: unknown, socket: import("net").Socket) => {
                resolve({ socket, response: new Response(null, { status: 101 }) });
            });
        })
        : { socket: null, response: new Response("WS not supported in this runtime", { status: 500 }) };

    if (!clientSocket) return response;

    // Подключаемся к Gemini с сервера
    // @ts-expect-error ws is available as transitive dependency
    const { WebSocket: NodeWS } = await import("ws");
    const geminiWs = new NodeWS(geminiWsUrl);

    geminiWs.on("open", () => {
        // Прокси готов
    });

    // Двусторонний прокси
    clientSocket.on("data", (data: Buffer) => {
        if (geminiWs.readyState === NodeWS.OPEN) {
            geminiWs.send(data);
        }
    });

    geminiWs.on("message", (data: Buffer | string) => {
        if (!clientSocket.destroyed) {
            clientSocket.write(data);
        }
    });

    geminiWs.on("close", () => clientSocket.destroy());
    clientSocket.on("close", () => geminiWs.close());
    geminiWs.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => geminiWs.close());

    void GEMINI_LIVE_MODEL; // reserved for future use

    return response;
}
