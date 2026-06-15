import { NextResponse } from "next/server";

import { assertCronAuthorized } from "@/lib/server/cron-auth";
import { createApiError } from "@/lib/server/api-validation";
import { reconcileVsIndex } from "@/lib/server/vs-index";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const authError = assertCronAuthorized(request);
    if (authError) {
      return NextResponse.json(authError, { status: 403 });
    }

    const summary = await reconcileVsIndex();

    return NextResponse.json(
      {
        synced: summary.synced,
        new: summary.new,
        stateChanges: summary.stateChanges,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to reconcile VS index";
    if (/DATABASE_URL is not configured/i.test(message)) {
      return NextResponse.json(
        {
          synced: 0,
          new: 0,
          stateChanges: 0,
          source: "contract",
        },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }

    return NextResponse.json(
      createApiError("internal_error", "Unable to reconcile VS index"),
      { status: 500 }
    );
  }
}
