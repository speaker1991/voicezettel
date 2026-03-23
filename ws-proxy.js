const { WebSocketServer, WebSocket } = require("ws");

const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-2.0-flash-live-001";
const PORT = process.env.GEMINI_PROXY_PORT || 3099;

const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GOOGLE_GEMINI_API_KEY}`;

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (clientWs) => {
  console.log("[Proxy] Client connected, connecting to Gemini...");
  console.log("[Proxy] Gemini URL:", GEMINI_URL.replace(GOOGLE_GEMINI_API_KEY, "***KEY***"));

  const geminiWs = new WebSocket(GEMINI_URL);
  let geminiReady = false;
  const pendingMessages = [];

  geminiWs.on("open", () => {
    console.log("[Proxy] Connected to Gemini, flushing", pendingMessages.length, "buffered messages");
    geminiReady = true;
    // Flush any messages that arrived while Gemini was connecting
    for (const msg of pendingMessages) {
      geminiWs.send(msg);
    }
    pendingMessages.length = 0;
  });

  geminiWs.on("message", (data) => {
    const preview = data.toString().slice(0, 300);
    console.log("[Proxy] Gemini → Client:", preview);
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
  });

  geminiWs.on("close", (code, reason) => {
    console.log("[Proxy] Gemini WS closed, code:", code, "reason:", reason?.toString());
    clientWs.close();
  });

  geminiWs.on("error", (e) => {
    console.error("[Proxy] Gemini error:", e.message);
    clientWs.close();
  });

  clientWs.on("message", (data) => {
    const str = data.toString();
    const preview = str.slice(0, 300);
    console.log("[Proxy] Client → Gemini:", preview);
    
    // Detect setup message and log system instruction
    try {
      const parsed = JSON.parse(str);
      if (parsed.setup && parsed.setup.system_instruction) {
        const sysText = parsed.setup.system_instruction.parts?.[0]?.text ?? "";
        console.log("[Proxy] SETUP system_instruction length:", sysText.length);
        console.log("[Proxy] SETUP first 500 chars:", sysText.slice(0, 500));
        // Check if "Красотка" is in the instruction
        if (sysText.includes("Красотка")) {
          console.log("[Proxy] ✅ 'Красотка' FOUND in system instruction!");
        } else {
          console.log("[Proxy] ❌ 'Красотка' NOT in system instruction");
        }
      }
    } catch { /* not JSON or no setup */ }
    if (geminiReady && geminiWs.readyState === WebSocket.OPEN) {
      geminiWs.send(data);
    } else {
      // Buffer message until Gemini WS is ready
      console.log("[Proxy] Gemini not ready, buffering message");
      pendingMessages.push(data);
    }
  });

  clientWs.on("close", (code, reason) => {
    console.log("[Proxy] Client WS closed, code:", code, "reason:", reason?.toString());
    geminiWs.close();
  });

  clientWs.on("error", () => geminiWs.close());
});

console.log(`[Proxy] WS proxy listening on ws://localhost:${PORT} (model: ${GEMINI_LIVE_MODEL})`);
