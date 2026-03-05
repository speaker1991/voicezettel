import { NextRequest } from "next/server";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { logger } from "@/lib/logger";

/**
 * Available Russian voices:
 * - ru-RU-SvetlanaNeural (female, default)
 * - ru-RU-DmitryNeural (male)
 * - ru-RU-DariyaNeural (female)
 */
const DEFAULT_VOICE = "ru-RU-SvetlanaNeural";

export async function POST(req: NextRequest) {
    const { text, voice } = (await req.json()) as {
        text: string;
        voice?: string;
    };

    if (!text || text.trim().length === 0) {
        return new Response("Empty text", { status: 400 });
    }

    try {
        const tts = new MsEdgeTTS();
        await tts.setMetadata(
            voice ?? DEFAULT_VOICE,
            OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
        );

        const { audioStream } = tts.toStream(text.slice(0, 5000));

        // Collect stream into buffer
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
            audioStream.on("data", (chunk: Buffer) => chunks.push(chunk));
            audioStream.on("end", resolve);
            audioStream.on("error", reject);
        });

        tts.close();

        const audioBuffer = Buffer.concat(chunks);

        if (audioBuffer.length === 0) {
            return new Response("Empty audio", { status: 500 });
        }

        return new Response(audioBuffer, {
            headers: {
                "Content-Type": "audio/mpeg",
                "Content-Length": String(audioBuffer.length),
                "Cache-Control": "no-cache",
            },
        });
    } catch (err) {
        logger.error("Edge TTS error:", (err as Error).message);
        return new Response("TTS error", { status: 500 });
    }
}
