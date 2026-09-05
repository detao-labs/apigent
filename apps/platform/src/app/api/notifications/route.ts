import { NextResponse } from "next/server";
import { listNotifications } from "@apigent/server/notifications";
import type { NotificationCategory } from "@apigent/server/notifications";
import { withRoute } from "@/lib/route";

const CATEGORIES: NotificationCategory[] = ["import", "context", "key", "mcp", "system"];

export const GET = withRoute({ auth: true }, async ({ request, user }) => {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category") as NotificationCategory | null;
  const unread = searchParams.get("unread") === "true";
  const limit = Number.parseInt(searchParams.get("limit") ?? "50", 10);

  const notifications = await listNotifications(user.id, {
    category: category && CATEGORIES.includes(category) ? category : undefined,
    unreadOnly: unread,
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 50,
  });
  return NextResponse.json({ notifications });
});
