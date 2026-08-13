"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge } from "@apigent/ui";
import {
  ArrowLeft,
  Boxes,
  History,
  LayoutDashboard,
  ListTree,
  Settings,
  Sparkles,
} from "lucide-react";
import type { RepoDetail } from "@/services/repos";

export function RepoRail({
  repoId,
  repo,
}: {
  repoId: string;
  repo: RepoDetail | null;
}) {
  const t = useTranslations("repos.detail");
  const nav = useTranslations("repos.detail.nav");
  const reposT = useTranslations("repos");
  const pathname = usePathname();
  const base = `/repos/${repoId}`;

  const items = [
    { key: "overview", label: nav("overview"), url: base, icon: LayoutDashboard },
    { key: "endpoints", label: nav("endpoints"), url: `${base}/endpoints`, icon: ListTree },
    { key: "schemas", label: nav("schemas"), url: `${base}/schemas`, icon: Boxes },
    { key: "context", label: nav("context"), url: `${base}/context`, icon: Sparkles },
    { key: "versions", label: nav("versions"), url: `${base}/versions`, icon: History },
    { key: "settings", label: nav("settings"), url: `${base}/settings`, icon: Settings },
  ];

  const isActive = (url: string) =>
    url === base ? pathname === base : pathname.startsWith(url);

  return (
    <aside className="sticky top-14 hidden h-[calc(100svh-3.5rem)] w-60 shrink-0 flex-col overflow-y-auto border-r bg-muted/20 p-3 md:flex">
      <Link href="/" className="flex items-center gap-2 px-2 py-1.5">
        <div className="flex aspect-square size-7 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
          <LayoutDashboard className="size-3.5" />
        </div>
        <span className="text-sm font-semibold">Apigent</span>
      </Link>

      <div className="mt-3 rounded-md bg-background p-3 ring-1 ring-border">
        <p className="truncate text-sm font-semibold">
          {repo?.name ?? repoId}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {repo?.orgName && (
            <Badge variant="secondary" className="max-w-full truncate text-xs">
              {repo.orgName}
            </Badge>
          )}
          {repo?.currentVersion && (
            <Badge variant="outline" className="font-mono text-xs">
              v{repo.currentVersion}
            </Badge>
          )}
        </div>
      </div>

      <p className="px-3 pt-4 pb-1.5 text-xs font-medium text-muted-foreground">
        {reposT("title")}
      </p>
      <nav className="space-y-0.5">
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.url}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
              isActive(item.url)
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            }`}
          >
            <item.icon className="size-4 shrink-0" />
            <span className="truncate">{item.label}</span>
          </Link>
        ))}
      </nav>

      <div className="mt-auto border-t pt-3">
        <Link
          href="/repos"
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ArrowLeft className="size-4" />
          {t("back")}
        </Link>
      </div>
    </aside>
  );
}
