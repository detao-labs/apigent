import { NextResponse } from "next/server";
import {
  NOTIFICATION_CATEGORIES,
  listNotificationPreferences,
  setNotificationPreference,
  type NotificationCategory,
} from "@apigent/server/notifications";
import { withRoute } from "@/lib/route";

export const GET = withRoute({ auth: true }, async ({ user }) => {
  const prefs = await listNotificationPreferences(user.id);
  return NextResponse.json({ prefs });
});

export const PATCH = withRoute({ auth: true }, async ({ request, user }) => {
  let body: { category?: string; enabled?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }
  const category = body.category as NotificationCategory;
  if (!NOTIFICATION_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "invalid-category" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }
  await setNotificationPreference(user.id, category, body.enabled);
  return NextResponse.json({ ok: true });
});
