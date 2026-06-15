import { moderateClaim } from "@/lib/server/claim-moderation";
import { handleClaimModerationPost } from "@/lib/server/claim-moderation-route-handler";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleClaimModerationPost({ request, moderateClaim });
}
