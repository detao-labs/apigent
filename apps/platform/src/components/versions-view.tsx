"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowRight, GitCompare, History, Loader2, RotateCcw } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@apigent/ui";
import type { DiffChange, DiffResult, RepoVersionRow } from "@apigent/server/versions";

const METHOD_STYLES: Record<string, string> = {
  GET: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  POST: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  PUT: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  PATCH: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  DELETE: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  default: "bg-muted text-muted-foreground",
};

function methodStyle(method: string) {
  return METHOD_STYLES[method] ?? METHOD_STYLES.default;
}

function formatTime(date: Date | string, locale: string) {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

function changeCategoryKey(change: DiffChange) {
  return change.category === "endpoint"
    ? "diffCategoryEndpoint"
    : change.category === "schema"
      ? "diffCategorySchema"
      : "diffCategoryComponent";
}

function changeTypeKey(change: DiffChange) {
  return change.changeType === "added"
    ? "diffAdded"
    : change.changeType === "removed"
      ? "diffRemoved"
      : "diffModified";
}

function impactKey(change: DiffChange) {
  if (change.breaking) return "diffBreaking";
  if (change.changeType === "added") return "diffCompatible";
  return "diffNonBreaking";
}

function impactBadgeClass(change: DiffChange) {
  if (change.breaking) return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
  if (change.changeType === "added")
    return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
  return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
}

export function VersionsView({
  repoId,
  versions,
  currentVersionId,
  canActivate,
}: {
  repoId: string;
  versions: RepoVersionRow[];
  currentVersionId: string | null;
  canActivate: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const t = useTranslations("repos.detail.versions");

  const [from, setFrom] = React.useState<string | null>(null);
  const [to, setTo] = React.useState<string | null>(null);
  const [diff, setDiff] = React.useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = React.useState(false);
  const [activateTarget, setActivateTarget] = React.useState<RepoVersionRow | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newParentId, setNewParentId] = React.useState("");
  const [newEmpty, setNewEmpty] = React.useState(false);
  const [createBusy, setCreateBusy] = React.useState(false);
  const [rollbackTarget, setRollbackTarget] = React.useState<RepoVersionRow | null>(null);

  // URL 参数恢复：?from=&to=
  React.useEffect(() => {
    const urlFrom = searchParams.get("from");
    const urlTo = searchParams.get("to");
    if (urlFrom && urlTo) {
      setFrom(urlFrom);
      setTo(urlTo);
    }
  }, []);

  const compare = (fromId: string, toId: string) => {
    const nextFrom = fromId;
    const nextTo = toId;
    setFrom(nextFrom);
    setTo(nextTo);
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("from", nextFrom);
    sp.set("to", nextTo);
    router.replace(`?${sp.toString()}`, { scroll: false });
  };

  React.useEffect(() => {
    if (!from || !to) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    fetch(`/api/repos/${repoId}/versions/diff?from=${from}&to=${to}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`diff failed: ${res.status}`);
        const data = (await res.json()) as { diff: DiffResult };
        if (!cancelled) setDiff(data.diff);
      })
      .catch(() => {
        if (!cancelled) {
          toast.error(t("diffError"));
          setDiff(null);
        }
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, repoId, t]);

  const doActivate = async () => {
    if (!activateTarget) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/repos/${repoId}/versions/${activateTarget.id}/activate`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`activate failed: ${res.status}`);
      toast.success(t("activateSuccess"));
      setActivateTarget(null);
      router.refresh();
    } catch {
      toast.error(t("activateFailed"));
    } finally {
      setBusy(false);
    }
  };

  const doCreateVersion = async () => {
    if (!newName.trim()) return;
    setCreateBusy(true);
    try {
      const res = await fetch(`/api/repos/${repoId}/versions/branches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          parentVersionId: newParentId || undefined,
          empty: newEmpty,
        }),
      });
      if (!res.ok) throw new Error(`create version failed: ${res.status}`);
      toast.success(t("createVersionSuccess"));
      setCreateOpen(false);
      setNewName("");
      setNewParentId("");
      setNewEmpty(false);
      router.refresh();
    } catch {
      toast.error(t("createVersionFailed"));
    } finally {
      setCreateBusy(false);
    }
  };

  const doRollback = async () => {
    if (!rollbackTarget) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/repos/${repoId}/versions/${rollbackTarget.id}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steps: 1 }),
      });
      if (!res.ok) throw new Error(`rollback failed: ${res.status}`);
      toast.success(t("rollbackSuccess"));
      setRollbackTarget(null);
      router.refresh();
    } catch {
      toast.error(t("rollbackFailed"));
    } finally {
      setBusy(false);
    }
  };

  if (versions.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <History className="mb-4 size-12 text-muted-foreground/50" />
          <h3 className="mb-1 text-lg font-semibold">{t("empty")}</h3>
          <p className="max-w-md text-muted-foreground">{t("emptyDesc")}</p>
        </CardContent>
      </Card>
    );
  }

  const versionLabel = (commitId: string | null) =>
    versions.find((v) => v.headCommitId === commitId)?.name ?? "";

  const diffFrom = from ? versionLabel(from) : "";
  const diffTo = to ? versionLabel(to) : "";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("sub")}</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <Button variant="secondary" onClick={() => setCreateOpen(true)}>
            新建版本
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新建版本</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <Input
                placeholder="版本名（如 v2 / dev）"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={newParentId}
                onChange={(e) => setNewParentId(e.target.value)}
              >
                <option value="">基于默认主版本 fork</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    基于 {v.name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={newEmpty}
                  onChange={(e) => setNewEmpty(e.target.checked)}
                />
                空树新建（不继承任何内容）
              </label>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                取消
              </Button>
              <Button onClick={doCreateVersion} disabled={createBusy || !newName.trim()}>
                创建
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>{t("colVersion")}</TableHead>
                <TableHead>{t("colImportedAt")}</TableHead>
                <TableHead>{t("colSource")}</TableHead>
                <TableHead className="text-right">{t("colEndpoints")}</TableHead>
                <TableHead className="text-right">{t("colModels")}</TableHead>
                <TableHead className="text-right">{t("colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions.map((v, index) => {
                const isCurrent = v.id === currentVersionId;
                const older = versions[index + 1];
                return (
                  <TableRow key={v.id}>
                    <TableCell className="font-mono">
                      <span className="flex items-center gap-2">
                        {v.name}
                        {isCurrent && (
                          <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
                            {t("currentBadge")}
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatTime(v.importedAt, locale)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{t("sourceImport")}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{v.endpointCount}</TableCell>
                    <TableCell className="text-right">{v.modelCount}</TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex items-center justify-end gap-2">
                        {!isCurrent && canActivate && (
                          <Button variant="ghost" size="sm" onClick={() => setActivateTarget(v)}>
                            <RotateCcw className="size-3.5" />
                            {t("actionActivate")}
                          </Button>
                        )}
                        {!isCurrent && canActivate && (
                          <Button variant="ghost" size="sm" onClick={() => setRollbackTarget(v)}>
                            <History className="size-3.5" />
                            回滚
                          </Button>
                        )}
                        {older && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (older.headCommitId && v.headCommitId) {
                                compare(older.headCommitId, v.headCommitId);
                              }
                            }}
                          >
                            <GitCompare className="size-3.5" />
                            {t("actionDiff")}
                          </Button>
                        )}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {from && to && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              <span className="inline-flex items-center gap-2">
                <span className="font-mono">{diffFrom}</span>
                <ArrowRight className="size-4 text-muted-foreground" />
                <span className="font-mono">{diffTo}</span>
                <span className="text-muted-foreground">{t("diffTitle")}</span>
              </span>
            </CardTitle>
            {diffLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </CardHeader>
          <CardContent className="space-y-4">
            {diff && !diffLoading && (
              <>
                <div className="flex flex-wrap gap-2">
                  <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
                    {t("diffAdded")} {diff.added}
                  </Badge>
                  <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    {t("diffModified")} {diff.modified}
                  </Badge>
                  <Badge className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                    {t("diffRemoved")} {diff.removed}
                  </Badge>
                  <Badge className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                    {t("diffBreaking")} {diff.breaking}
                  </Badge>
                </div>

                {diff.changes.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">{t("diffEmpty")}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableHead>{t("diffType")}</TableHead>
                        <TableHead>{t("diffObject")}</TableHead>
                        <TableHead>{t("diffLabel")}</TableHead>
                        <TableHead className="text-right">{t("diffImpact")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {diff.changes.map((change) => (
                        <TableRow key={change.id}>
                          <TableCell>
                            <Badge variant="outline">{t(changeCategoryKey(change))}</Badge>
                          </TableCell>
                          <TableCell className="font-mono">
                            <span className="inline-flex items-center gap-2">
                              {change.method && (
                                <span
                                  className={`rounded px-1.5 py-0.5 text-xs font-semibold ${methodStyle(change.method)}`}
                                >
                                  {change.method}
                                </span>
                              )}
                              {change.subject}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="flex flex-col gap-0.5">
                              <span className="text-sm">{t(changeTypeKey(change))}</span>
                              {change.fieldsChanged.length > 0 && (
                                <span className="text-xs text-muted-foreground">
                                  {change.fieldsChanged.join(", ")}
                                </span>
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge className={impactBadgeClass(change)}>
                              {t(impactKey(change))}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </>
            )}
            {!diffLoading && !diff && (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("diffEmpty")}</p>
            )}
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={activateTarget !== null}
        onOpenChange={(open) => !open && setActivateTarget(null)}
        title={t("activateTitle")}
        description={t("activateDesc")}
        confirmText={t("activateBtn")}
        cancelText={t("cancel")}
        destructive
        loading={busy}
        onConfirm={doActivate}
      />
      <ConfirmDialog
        open={rollbackTarget !== null}
        onOpenChange={(open) => !open && setRollbackTarget(null)}
        title="回滚"
        description={`确定回滚到上一版吗？当前「${rollbackTarget?.name ?? ""}」的内容将被指向其上一个快照。`}
        confirmText="回滚"
        cancelText="取消"
        destructive
        loading={busy}
        onConfirm={doRollback}
      />
    </div>
  );
}
