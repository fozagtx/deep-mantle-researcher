import { NextResponse } from "next/server";

import { assertCronAuthorized } from "@/lib/server/cron-auth";
import { createApiError } from "@/lib/server/api-validation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authError = assertCronAuthorized(request);
  if (authError) {
    return NextResponse.json(authError, { status: 403 });
  }

  process.env.MAX_CLAIMS_PER_RUN ||= "1";
  process.env.MAX_ACTIVE_CLAIMS ||= "12";

  try {
    const { runMarketCreatorOnce } = await import("@/agents/market-creator");
    await runMarketCreatorOnce();
    return NextResponse.json(
      { ok: true, ran: "market-creator", at: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to run market creator";
    return NextResponse.json(
      createApiError("internal_error", message),
      { status: /env var is required|private key/i.test(message) ? 503 : 500 },
    );
  }
}
