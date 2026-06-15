import { createApiError } from "./api-validation";

export function assertCronAuthorized(request: Request) {
  const expectedSecret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get("authorization") ?? "";

  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return createApiError("forbidden", "Invalid cron credentials");
  }

  return null;
}
