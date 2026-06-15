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

  try {
    const { runOracleOnce } = await import("@/agents/oracle");
    await runOracleOnce();
    return NextResponse.json(
      { ok: true, ran: "oracle", at: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to run oracle";
    return NextResponse.json(
      createApiError("internal_error", message),
      { status: /env var is required|private key/i.test(message) ? 503 : 500 },
    );
  }
}
