"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  buttonVariants,
  Card,
  CardContent,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@apigent/ui";
import {
  ArrowRight,
  Database,
  ExternalLink,
  Plus,
  X,
} from "lucide-react";
import Link from "next/link";
import type { RepoSummary } from "@/services/repos";
import { formatRelativeTime } from "@/lib/format";

export function ReposView({
  repos,
  initialOrg,
  locale,
}: {
  repos: RepoSummary[];
  initialOrg?: string;
  locale: string;
}) {
  const t = useTranslations("repos");
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [org, setOrg] = React.useState(initialOrg ?? "all");
  const [mcp, setMcp] = React.useState("all");

  const orgs = React.useMemo(() => {
    const map = new Map<string, { name: string; slug: string }>();
    for (const repo of repos) {
      if (repo.orgName && repo.orgSlug) {
        map.set(repo.orgSlug, { name: repo.orgName, slug: repo.orgSlug });
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [repos]);

  const filtered = repos.filter((repo) => {
    const q = query.trim().toLowerCase();
    const matchesQuery =
      !q ||
      repo.name.toLowerCase().includes(q) ||
      (repo.description ?? "").toLowerCase().includes(q);
    const matchesOrg = org === "all" || repo.orgSlug === org;
    const matchesMcp =
      mcp === "all" ||
      (mcp === "on" && repo.mcpEnabled) ||
      (mcp === "off" && !repo.mcpEnabled);
    return matchesQuery && matchesOrg && matchesMcp;
  });

  const hasFilters = query !== "" || org !== "all" || mcp !== "all";

  function clearFilters() {
    setQuery("");
    setOrg("all");
    setMcp("all");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("description")}</p>
        </div>
        <Link href="/repos/new" className={buttonVariants()}>
          <Plus className="size-4" />
          {t("new.title")}
        </Link>
      </div>

      {repos.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Database className="mb-4 size-12 text-muted-foreground/50" />
            <h3 className="mb-1 text-lg font-semibold">{t("empty.title")}</h3>
            <p className="mb-6 text-muted-foreground">{t("empty.description")}</p>
            <Link href="/repos/new" className={buttonVariants()}>
              <Plus className="size-4" />
              {t("new.title")}
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              type="search"
              placeholder={t("toolbar.searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="sm:max-w-xs"
            />
            <select
              aria-label={t("toolbar.allOrgs")}
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="all">{t("toolbar.allOrgs")}</option>
              {orgs.map((o) => (
                <option key={o.slug} value={o.slug}>
                  {o.name}
                </option>
              ))}
            </select>
            <select
              aria-label={t("toolbar.allMcp")}
              value={mcp}
              onChange={(e) => setMcp(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="all">{t("toolbar.allMcp")}</option>
              <option value="on">{t("toolbar.enabled")}</option>
              <option value="off">{t("toolbar.disabled")}</option>
            </select>
            {hasFilters && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={clearFilters}
                className="gap-1.5"
              >
                <X className="size-3.5" />
                {t("toolbar.filtered")} · {t("toolbar.clear")}
              </Button>
            )}
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>{t("table.name")}</TableHead>
                    <TableHead>{t("table.org")}</TableHead>
                    <TableHead className="text-right">{t("table.endpoints")}</TableHead>
                    <TableHead>{t("table.version")}</TableHead>
                    <TableHead>{t("table.mcp")}</TableHead>
                    <TableHead>{t("table.updated")}</TableHead>
                    <TableHead className="text-right">{t("table.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((repo) => (
                    <TableRow
                      key={repo.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/repos/${repo.id}`)}
                    >
                      <TableCell>
                        <Link
                          href={`/repos/${repo.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="block font-medium hover:text-primary"
                        >
                          {repo.name}
                        </Link>
                        {repo.description && (
                          <p className="max-w-xs truncate text-sm text-muted-foreground">
                            {repo.description}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {repo.orgName ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {repo.endpointCount}
                      </TableCell>
                      <TableCell>
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                          {repo.currentVersion ?? "—"}
                        </code>
                      </TableCell>
                      <TableCell>
                        {repo.mcpEnabled ? (
                          <Badge className="bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-900/40 dark:text-green-300">
                            {t("table.enabled")}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">{t("table.disabled")}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatRelativeTime(repo.updatedAt, locale)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/repos/${repo.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className={buttonVariants({
                            variant: "ghost",
                            size: "sm",
                          })}
                        >
                          <ExternalLink className="size-3" />
                          {t("table.details")}
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {filtered.length === 0 && (
                <div className="flex flex-col items-center py-12 text-center">
                  <ArrowRight className="mb-3 size-8 rotate-90 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">
                    {t("toolbar.noMatch")}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
