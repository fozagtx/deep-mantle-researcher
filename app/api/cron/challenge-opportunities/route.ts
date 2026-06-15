import { NextResponse } from "next/server";

import { assertCronAuthorized } from "@/lib/server/cron-auth";
import { createApiError } from "@/lib/server/api-validation";
import { refreshChallengeOpportunitiesIndex } from "@/lib/server/challenge-opportunities";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const authError = assertCronAuthorized(request);
    if (authError) {
      return NextResponse.json(authError, { status: 403 });
    }

    if (process.env.NEXT_PUBLIC_FEATURE_SOURCE_DRAFTS !== "1") {
      return NextResponse.json(
        createApiError("feature_disabled", "Challenge opportunities are not enabled"),
        { status: 404 }
      );
    }

    const summary = await refreshChallengeOpportunitiesIndex();

    return NextResponse.json(
      {
        generatedAt: new Date(summary.generatedAt).toISOString(),
        count: summary.count,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to refresh challenge opportunities";

    return NextResponse.json(
      createApiError("internal_error", message),
      { status: /not configured/i.test(message) ? 503 : 500 }
    );
  }
}
