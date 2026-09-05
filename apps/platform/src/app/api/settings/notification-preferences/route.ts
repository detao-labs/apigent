import { NextResponse } from "next/server";
import { getSessionUser } from "@/services/auth";
import {
  NOTIFICATION_CATEGORIES,
  listNotificationPreferences,
  setNotificationPreference,
  type NotificationCategory,
} from "@apigent/server/notifications";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const prefs = await listNotificationPreferences(user.id);
  return NextResponse.json({ prefs });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
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
}
