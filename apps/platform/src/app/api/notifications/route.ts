import { NextResponse } from "next/server";
import { getSessionUser } from "@/services/auth";
import { listNotifications } from "@apigent/server/notifications";
import type { NotificationCategory } from "@apigent/server/notifications";

const CATEGORIES: NotificationCategory[] = ["import", "context", "key", "mcp", "system"];

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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
}
