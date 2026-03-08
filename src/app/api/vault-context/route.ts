import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadVaultContext } from "@/lib/vaultContext";

const RequestSchema = z.object({
    userId: z.string().default("anonymous"),
});

export async function POST(req: NextRequest) {
    const raw: unknown = await req.json();
    const parsed = RequestSchema.safeParse(raw);

    if (!parsed.success) {
        return NextResponse.json({ context: "" }, { status: 400 });
    }

    const { userId } = parsed.data;
    const context = await loadVaultContext(userId);

    return NextResponse.json({ context });
}
