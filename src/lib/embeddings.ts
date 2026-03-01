import { logger } from "@/lib/logger";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 1536;

/**
 * Generate an embedding vector for the given text using OpenAI.
 * Returns a zero vector if the API key is missing or on error.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
    if (!OPENAI_API_KEY) {
        logger.error("OPENAI_API_KEY not set — skipping embedding");
        return new Array(EMBEDDING_DIMS).fill(0);
    }

    try {
        const res = await fetch("https://api.openai.com/v1/embeddings", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: EMBEDDING_MODEL,
                input: text.slice(0, 8000), // limit input length
            }),
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Embeddings API ${res.status}: ${errText}`);
        }

        const data = (await res.json()) as {
            data?: Array<{ embedding?: number[] }>;
        };

        const embedding = data.data?.[0]?.embedding;
        if (!embedding || embedding.length === 0) {
            throw new Error("Empty embedding returned");
        }

        return embedding;
    } catch (err) {
        logger.error(
            `Embedding error: ${err instanceof Error ? err.message : "Unknown"}`,
        );
        return new Array(EMBEDDING_DIMS).fill(0);
    }
}

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) return 0;

    return dotProduct / denom;
}
