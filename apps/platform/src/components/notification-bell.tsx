"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@apigent/ui";
import { Bell, CheckCheck, Circle } from "lucide-react";

type Category = "import" | "context" | "key" | "mcp" | "system";
type Priority = "high" | "medium" | "low";

interface NotificationItem {
  id: string;
  category: Category;
  type: string;
  priority: Priority;
  titleKey: string;
  titleParams: Record<string, unknown>;
  payload: { href?: string } & Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

const CATEGORY_ORDER: Category[] = ["import", "context", "key", "mcp", "system"];

const PRIORITY_DOT: Record<Priority, string> = {
  high: "fill-destructive text-destructive",
  medium: "fill-amber-500 text-amber-500",
  low: "fill-muted-foreground/40 text-muted-foreground/40",
};

export function NotificationBell() {
  const t = useTranslations("notifications");
  const router = useRouter();
  const [items, setItems] = React.useState<NotificationItem[]>([]);
  const [unread, setUnread] = React.useState(0);
  const [open, setOpen] = React.useState(false);

  const refreshUnread = React.useCallback(async () => {
    try {
      const res = await fetch("/api/notifications/unread-count", { cache: "no-store" });
      const data = (await res.json()) as { count?: number };
      setUnread(Number(data.count ?? 0));
    } catch {
      // ignore
    }
  }, []);

  const refreshList = React.useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=30", { cache: "no-store" });
      const data = (await res.json()) as { notifications?: NotificationItem[] };
      if (data.notifications) setItems(data.notifications);
      void refreshUnread();
    } catch {
      // ignore
    }
  }, [refreshUnread]);

  React.useEffect(() => {
    void refreshUnread();
    const timer = setInterval(() => void refreshUnread(), 30_000);
    return () => clearInterval(timer);
  }, [refreshUnread]);

  function openNotification(item: NotificationItem) {
    if (item.payload.href) router.push(item.payload.href);
    if (!item.readAt) {
      setItems((prev) =>
        prev.map((n) =>
          n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n,
        ),
      );
      setUnread((c) => Math.max(0, c - 1));
      void fetch(`/api/notifications/${item.id}/read`, { method: "POST" }).catch(() => {});
    }
  }

  async function markAllRead() {
    await fetch("/api/notifications/read-all", { method: "POST" }).catch(() => {});
    setItems((prev) =>
      prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })),
    );
    setUnread(0);
  }

  function titleOf(item: NotificationItem): string {
    const key = item.titleKey.startsWith("notifications.")
      ? item.titleKey.slice("notifications.".length)
      : item.titleKey;
    return t(key, item.titleParams as Record<string, string | number | Date>);
  }

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: items.filter((n) => n.category === category),
  })).filter((g) => g.items.length > 0);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void refreshList();
      }}
    >
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={t("title")} />}
      >
        <span className="relative">
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between pr-2">
          <div className="px-3 py-1.5 text-sm font-medium">{t("title")}</div>
          {unread > 0 && (
            <Button
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => void markAllRead()}
            >
              <CheckCheck className="size-3.5" />
              {t("markAllRead")}
            </Button>
          )}
        </div>
        <DropdownMenuSeparator />
        {grouped.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            {t("empty")}
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {grouped.map(({ category, items: group }) => (
              <DropdownMenuGroup key={category}>
                <DropdownMenuLabel className="px-3 pt-3 text-xs font-medium text-muted-foreground">
                  {t(`categories.${category}`)}
                </DropdownMenuLabel>
                {group.map((item) => (
                  <DropdownMenuItem
                    key={item.id}
                    className="items-start gap-2 py-2"
                    onClick={() => openNotification(item)}
                  >
                    <Circle
                      className={`mt-1.5 size-2 shrink-0 ${PRIORITY_DOT[item.priority]}`}
                    />
                    <span
                      className={`min-w-0 text-sm ${
                        item.readAt ? "text-muted-foreground" : "font-medium"
                      }`}
                    >
                      {titleOf(item)}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
