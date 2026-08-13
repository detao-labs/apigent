"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SidebarTrigger,
} from "@apigent/ui";
import {
  Check,
  ChevronDown,
  Languages,
  LogOut,
  Monitor,
  Moon,
  Search,
  Settings,
  Sun,
  User,
} from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import { NotificationBell } from "@/components/notification-bell";

const LOCALE_COOKIE = "NEXT_LOCALE";

export function AppHeader({
  user,
}: {
  user: { name: string; email: string };
}) {
  const t = useTranslations("topbar");
  const auth = useTranslations("auth");
  const router = useRouter();
  const locale = useLocale();
  const { mode, setMode } = useTheme();

  function setLocale(next: "zh" | "en") {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; SameSite=Lax`;
    router.refresh();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
      <SidebarTrigger className="md:hidden" />

      <div className="relative hidden max-w-md flex-1 items-center sm:flex">
        <Search className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" />
        <input
          type="search"
          role="searchbox"
          aria-label={t("searchPlaceholder")}
          placeholder={t("searchPlaceholder")}
          className="h-9 w-full rounded-md border border-input bg-muted/30 pr-14 pl-8 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
        />
        <kbd className="pointer-events-none absolute right-2.5 hidden items-center rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
          ⌘K
        </kbd>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <NotificationBell />

        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label={t("systemSettings")} />}
          >
            <Settings className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t("theme")}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setMode("light")}>
                <Sun className="size-4" />
                {t("light")}
                {mode === "light" && <Check className="ml-auto size-4" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setMode("dark")}>
                <Moon className="size-4" />
                {t("dark")}
                {mode === "dark" && <Check className="ml-auto size-4" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setMode("system")}>
                <Monitor className="size-4" />
                {t("system")}
                {mode === "system" && <Check className="ml-auto size-4" />}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t("language")}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setLocale("zh")}>
                <Languages className="size-4" />
                {t("chinese")}
                {locale === "zh" && <Check className="ml-auto size-4" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLocale("en")}>
                <Languages className="size-4" />
                {t("english")}
                {locale === "en" && <Check className="ml-auto size-4" />}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              {t("version")}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" className="gap-2 px-2" aria-label={t("userMenu")} />}
          >
            <Avatar className="size-7">
              <AvatarFallback>{user.name.charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
            <ChevronDown className="hidden size-3.5 text-muted-foreground sm:block" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <p className="text-sm font-medium">{user.name}</p>
                <p className="truncate text-xs font-normal text-muted-foreground">
                  {user.email}
                </p>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/settings" />}>
              <User className="size-4" />
              {t("profile")}
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href="/settings" />}>
              <Settings className="size-4" />
              {t("settings")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={logout}>
              <LogOut className="size-4" />
              {auth("logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
