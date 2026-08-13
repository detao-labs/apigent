"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Badge,
  Button,
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@apigent/ui";
import {
  ArrowRight,
  Boxes,
  History,
  KeyRound,
  Link2,
  ListTree,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { ImportVersionDialog } from "@/components/import-version-dialog";
import { formatRelativeTime } from "@/lib/format";
import type { RepoDetail } from "@/services/repos";
import type { ContextTaskSummary } from "@apigent/server/contexts";

const MCP_SERVICE_URL = "https://apigent.acme.dev/mcp";

interface LatestImportTask {
  taskId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  error?: string | null;
}

export function RepoOverview({
  repo,
  locale,
  latestTask,
  latestContextTask,
}: {
  repo: RepoDetail;
  locale: string;
  latestTask?: LatestImportTask | null;
  latestContextTask?: ContextTaskSummary | null;
}) {
  const t = useTranslations("repos.detail");
  const common = useTranslations("common");
  const router = useRouter();
  const [mcp, setMcp] = React.useState(repo.mcpEnabled);
  const [mcpConfirmOpen, setMcpConfirmOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [task, setTask] = React.useState<LatestImportTask | null>(latestTask ?? null);
  const [contextTask, setContextTask] = React.useState<ContextTaskSummary | null>(
    latestContextTask ?? null,
  );
  const [regenerating, setRegenerating] = React.useState(false);

  const hasContext =
    repo.capabilityContext !== null &&
    Object.keys(repo.capabilityContext).length > 0;

  // 导入任务进行中时轮询最新状态（5s），失败/成功即停止
  const taskActive = task?.status === "queued" || task?.status === "running";
  React.useEffect(() => {
    if (!taskActive) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/repos/${repo.id}/import-tasks/latest`, {
          cache: "no-store",
        });
        const data = (await res.json()) as { task?: LatestImportTask | null };
        setTask(data.task ?? null);
      } catch {
        // 网络抖动继续轮询
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [taskActive, repo.id]);

  function toggleMcp() {
    if (mcp) {
      setMcpConfirmOpen(true);
      return;
    }
    setMcp(!mcp);
  }

  async function regenerate() {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/repos/${repo.id}/contexts/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const started = Date.now();
        while (Date.now() - started < 10 * 60 * 1000) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          const taskRes = await fetch(
            `/api/repos/${repo.id}/context-tasks/latest`,
            { cache: "no-store" },
          );
          const data = (await taskRes.json()) as {
            task?: ContextTaskSummary;
          };
          setContextTask(data.task ?? null);
          if (
            data.task &&
            (data.task.status === "succeeded" || data.task.status === "failed")
          ) {
            break;
          }
        }
      }
      router.refresh();
      toast.success(t("capability.regenerated"));
    } catch {
      toast.error(t("capability.generateFailed"));
    } finally {
      setRegenerating(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      /* clipboard unavailable */
    }
  }

  const stats = [
    {
      label: t("stats.endpoints"),
      value: repo.endpointCount,
      href: `/repos/${repo.id}/endpoints`,
      icon: ListTree,
    },
    {
      label: t("stats.models"),
      value: repo.modelCount,
      href: `/repos/${repo.id}/schemas`,
      icon: Boxes,
    },
    {
      label: t("stats.versions"),
      value: repo.versionCount,
      href: `/repos/${repo.id}/versions`,
      icon: History,
    },
  ];

  return (
    <div className="space-y-6">
      {/* 标题行 + 主操作 */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight">
            {repo.name}
            {repo.orgName && (
              <Badge variant="secondary" className="max-w-56 truncate">
                {repo.orgName}
              </Badge>
            )}
            {repo.currentVersion && (
              <Badge variant="outline" className="font-mono">
                {repo.currentVersion}
                {repo.currentSpecVersion && ` · ${repo.currentSpecVersion}`}
              </Badge>
            )}
            {taskActive && (
              <Badge
                variant="secondary"
                className="gap-1 bg-amber-100/70 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
              >
                <Loader2 className="size-3 animate-spin" />
                {t("importRunning")}
              </Badge>
            )}
            {task?.status === "failed" && (
              <Badge variant="destructive">{t("importFailedBadge")}</Badge>
            )}
            <span className="ml-1 inline-flex items-center gap-2 text-sm font-normal text-muted-foreground">
              {t("mcp")}
              <button
                type="button"
                role="switch"
                aria-checked={mcp}
                aria-label={t("mcp")}
                onClick={toggleMcp}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                  mcp ? "bg-primary" : "bg-input"
                }`}
              >
                <span
                  className={`inline-block size-3.5 transform rounded-full bg-white shadow transition-transform ${
                    mcp ? "translate-x-[18px]" : "translate-x-[3px]"
                  }`}
                />
              </button>
            </span>
          </h1>
          {repo.description && (
            <p className="mt-1 text-muted-foreground">{repo.description}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  aria-label={t("more")}
                />
              }
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem disabled title={common("backendPending")}>
                <Pencil className="size-4" />
                {t("editInfo")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={copyLink}>
                <Link2 className="size-4" />
                {t("copyLink")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled
                title={common("backendPending")}
              >
                <Trash2 className="size-4" />
                {t("deleteRepo")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button type="button" onClick={() => setImportOpen(true)}>
            <Upload className="size-4" />
            {t("importVersion")}
          </Button>
        </div>
      </div>

      <ImportVersionDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        repoId={repo.id}
        repoName={repo.name}
        onImported={() => router.refresh()}
      />

      {/* 能力上下文 */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              {t("capability.title")}
              {hasContext && (
                <Badge className="bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-900/40 dark:text-green-300">
                  {t("capability.generated")}
                </Badge>
              )}
              {contextTask &&
                (contextTask.status === "queued" ||
                  contextTask.status === "running") && (
                  <Badge variant="secondary" className="gap-1.5">
                    <Loader2 className="size-3 animate-spin" />
                    {t("capability.generating")} {contextTask.progress}%
                  </Badge>
                )}
            </CardTitle>
            <CardDescription>{t("capability.sub")}</CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={`/repos/${repo.id}/context`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {t("capability.manage")}
            </Link>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={regenerate}
              disabled={regenerating}
            >
              <RefreshCw
                className={`size-3.5 ${regenerating ? "animate-spin" : ""}`}
              />
              {regenerating
                ? t("capability.generating")
                : t("capability.regen")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {hasContext ? (
            <dl className="space-y-3">
              {[
                ["intent", t("capability.intent")],
                ["constraints", t("capability.constraints")],
                ["sideEffects", t("capability.sideEffects")],
                ["usageScenarios", t("capability.scenarios")],
              ].map(
                ([key, label]) =>
                  repo.capabilityContext![key] !== undefined && (
                    <div key={key} className="flex flex-col gap-1 sm:flex-row">
                      <dt className="w-24 shrink-0 text-sm text-muted-foreground">
                        {label}
                      </dt>
                      <dd className="text-sm">
                        {contextText(repo.capabilityContext![key])}
                      </dd>
                    </div>
                  ),
              )}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("capability.empty")}
            </p>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={mcpConfirmOpen}
        onOpenChange={setMcpConfirmOpen}
        title={t("mcpConfirmTitle")}
        description={t("mcpConfirmDescription")}
        confirmText={common("confirm")}
        cancelText={common("cancel")}
        onConfirm={() => {
          setMcpConfirmOpen(false);
          setMcp(false);
        }}
      />

      {/* 统计 + MCP 接入 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href} className="group">
            <Card className="transition-colors group-hover:border-primary/50">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">
                  {stat.label}
                </CardTitle>
                <stat.icon className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <span className="text-2xl font-bold">{stat.value}</span>
                <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </CardContent>
            </Card>
          </Link>
        ))}
        <Card className="bg-muted/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {t("mcpPanel.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <code className="block truncate rounded-md bg-background px-2 py-1 text-xs ring-1 ring-border">
              {MCP_SERVICE_URL}
            </code>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={mcpConfigSnippet()} label={t("mcpPanel.copyConfig")} />
              <Link
                href="/settings?section=keys"
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                <KeyRound className="size-3.5" />
                {t("mcpPanel.generateKey")}
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 最近版本 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">
              {t("recentVersions.title")}
            </CardTitle>
            <CardDescription>{t("recentVersions.description")}</CardDescription>
          </div>
          <Link
            href={`/repos/${repo.id}/versions`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            {t("recentVersions.viewAll")}
            <ArrowRight className="size-3.5" />
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {repo.versions.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              {t("recentVersions.empty")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>{t("recentVersions.version")}</TableHead>
                  <TableHead>{t("recentVersions.importedAt")}</TableHead>
                  <TableHead>{t("recentVersions.source")}</TableHead>
                  <TableHead className="text-right">
                    {t("recentVersions.endpointCount")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("recentVersions.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {repo.versions.map((version) => (
                  <TableRow
                    key={version.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/repos/${repo.id}/versions`)}
                  >
                    <TableCell>
                      <span className="font-mono text-sm">
                        {version.version}
                        {version.specVersion && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {version.specVersion}
                          </span>
                        )}
                      </span>
                      {version.id === repo.versions[0]?.id &&
                        repo.versionCount > 0 && (
                          <Badge
                            variant="secondary"
                            className="ml-2 text-xs"
                          >
                            {t("recentVersions.current")}
                          </Badge>
                        )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatRelativeTime(version.importedAt, locale)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {version.source}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {version.endpointCount}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/repos/${repo.id}/versions`}
                        onClick={(e) => e.stopPropagation()}
                        className={buttonVariants({
                          variant: "ghost",
                          size: "sm",
                        })}
                      >
                        {t("recentVersions.compare")}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function contextText(value: unknown): string {
  if (Array.isArray(value)) return value.join("；");
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function mcpConfigSnippet() {
  return `{
  "mcpServers": {
    "apigent": {
      "url": "${MCP_SERVICE_URL}",
      "headers": { "Authorization": "Bearer <your-key>" }
    }
  }
}`;
}
