"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

export function RepoMobileNav({ repoId }: { repoId: string }) {
  const t = useTranslations("repos.detail.nav");
  const pathname = usePathname();
  const base = `/repos/${repoId}`;

  const items = [
    { key: "overview", label: t("overview"), url: base },
    { key: "definitions", label: t("definitions"), url: `${base}/definition` },
    { key: "context", label: t("context"), url: `${base}/context` },
    { key: "versions", label: t("versions"), url: `${base}/versions` },
    { key: "history", label: t("history"), url: `${base}/history` },
    { key: "settings", label: t("settings"), url: `${base}/settings` },
  ];

  const isActive = (url: string) =>
    url === base ? pathname === base : pathname.startsWith(url);

  return (
    <nav className="flex gap-1 overflow-x-auto border-b bg-background px-3 py-2 md:hidden">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.url}
          className={`shrink-0 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
            isActive(item.url)
              ? "bg-accent font-medium text-accent-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
