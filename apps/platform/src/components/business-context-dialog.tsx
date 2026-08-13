"use client";

// ═══════════════════════════════════════════════════════════════════
// BusinessContextDialog — 全局业务上下文编辑对话框
// ═══════════════════════════════════════════════════════════════════
//
// 由 URL 参数驱动（?dialog=business-context&repo=&endpoint=）：
//   - 显示接口技术信息 + 上下文状态徽章；
//   - 可编辑 capability_name / intent / constraints / side_effects / usage_scenarios；
//   - 保存走 PUT（人工编辑优先）；重新生成走生成任务（endpointIds 单接口）。
// 完整设计见 docs/modules/agent-runtime.md §6 / business-context.md §6。
// ═══════════════════════════════════════════════════════════════════

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
} from "@apigent/ui";
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { CONSTRAINT_TYPES } from "@apigent/core/agent";
import type { EndpointContextSummary } from "@/services/contexts";
import type { ContextTaskSummary } from "@apigent/server/contexts";

type ConstraintRow = { type: string; rule: string };

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

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function BusinessContextDialog() {
  const t = useTranslations("contexts");
  const common = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const dialog = searchParams.get("dialog");
  const repoId = searchParams.get("repo");
  const endpointIdParam = searchParams.get("endpoint");
  const open = dialog === "business-context" && Boolean(repoId);

  // 数据与表单
  const [items, setItems] = React.useState<EndpointContextSummary[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [regenerating, setRegenerating] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const [capabilityName, setCapabilityName] = React.useState("");
  const [intent, setIntent] = React.useState("");
  const [constraints, setConstraints] = React.useState<ConstraintRow[]>([]);
  const [sideEffectsText, setSideEffectsText] = React.useState("");
  const [usageScenariosText, setUsageScenariosText] = React.useState("");

  const selected =
    items.find((item) => item.endpointId === selectedId) ?? null;
  const hasContext = Boolean(selected && selected.capabilityName);

  const close = React.useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    params.delete("dialog");
    params.delete("repo");
    params.delete("endpoint");
    router.replace(`${pathname}?${params.toString()}`);
  }, [pathname, router]);

  const selectEndpoint = React.useCallback(
    (endpointId: string | null) => {
      const params = new URLSearchParams(window.location.search);
      if (endpointId) {
        params.set("endpoint", endpointId);
      } else {
        params.delete("endpoint");
      }
      router.replace(`${pathname}?${params.toString()}`);
    },
    [pathname, router],
  );

  // 打开时加载接口上下文列表；endpointId 优先，缺省选中第一个
  React.useEffect(() => {
    if (!open || !repoId) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/repos/${repoId}/contexts`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { contexts: EndpointContextSummary[] }) => {
        if (cancelled) return;
        setItems(data.contexts);
        const target =
          data.contexts.find((item) => item.endpointId === endpointIdParam) ??
          data.contexts[0] ??
          null;
        setSelectedId(target?.endpointId ?? null);
      })
      .catch(() => {
        /* 网络抖动保持空列表 */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, repoId, endpointIdParam]);

  // 切换接口时回填表单
  React.useEffect(() => {
    if (!selected) {
      setCapabilityName("");
      setIntent("");
      setConstraints([]);
      setSideEffectsText("");
      setUsageScenariosText("");
      return;
    }
    // 列表接口不含完整 context 字段时，需要拉详情
    if (selected.intent === undefined) return;
    setCapabilityName(selected.capabilityName ?? "");
    setIntent(selected.intent ?? "");
    setConstraints(
      (selected.constraints as ConstraintRow[] | null) ?? [],
    );
    setSideEffectsText((selected.sideEffects ?? []).join("\n"));
    setUsageScenariosText((selected.usageScenarios ?? []).join("\n"));
  }, [selected]);

  async function save() {
    if (!repoId || !selectedId || !selected) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/repos/${repoId}/contexts/${selectedId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            capabilityName,
            intent,
            constraints,
            sideEffects: splitLines(sideEffectsText),
            usageScenarios: splitLines(usageScenariosText),
            confidence: selected.confidence ?? 0.8,
            needsReview: false,
          }),
        },
      );
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      toast.success(t("saved"));
      close();
    } catch {
      toast.error(t("generateFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function refresh() {
    if (!repoId) return;
    const res = await fetch(`/api/repos/${repoId}/contexts`, {
      cache: "no-store",
    });
    const data = (await res.json()) as { contexts: EndpointContextSummary[] };
    setItems(data.contexts);
  }

  async function regenerate() {
    if (!repoId || !selectedId) return;
    setRegenerating(true);
    try {
      const res = await fetch(`/api/repos/${repoId}/contexts/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpointIds: [selectedId] }),
      });
      if (!res.ok) throw new Error(`generate failed: ${res.status}`);
      const data = (await res.json()) as { task?: ContextTaskSummary };
      const taskId = data.task?.taskId;
      // 轮询任务直到完成（单接口生成通常 30-90s）
      if (taskId) {
        const started = Date.now();
        while (Date.now() - started < 5 * 60 * 1000) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          const taskRes = await fetch(
            `/api/repos/${repoId}/context-tasks/${taskId}`,
            { cache: "no-store" },
          );
          const taskData = (await taskRes.json()) as {
            task?: ContextTaskSummary;
          };
          const task = taskData.task;
          if (task && (task.status === "succeeded" || task.status === "failed")) {
            break;
          }
        }
      }
      await refresh();
      toast.success(t("regenerated"));
    } catch {
      toast.error(t("generateFailed"));
    } finally {
      setRegenerating(false);
    }
  }

  function updateConstraint(index: number, patch: Partial<ConstraintRow>) {
    setConstraints((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {selected && (
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-xs ${methodStyle(selected.method)}`}
              >
                {selected.method}
              </span>
            )}
            <span className="font-mono text-sm">{selected?.path ?? "—"}</span>
            {selected && hasContext && (
              <Badge
                variant={
                  selected.needsReview
                    ? "default"
                    : selected.editedByHuman
                      ? "secondary"
                      : "default"
                }
              >
                {selected.needsReview
                  ? t("needsReview")
                  : selected.editedByHuman
                    ? t("humanEdited")
                    : t("generated")}
              </Badge>
            )}
            {selected && !hasContext && <Badge variant="outline">{t("notGenerated")}</Badge>}
          </DialogTitle>
          <DialogDescription>
            {t("subtitle")}
            {selected && hasContext && (
              <span className="ml-2 text-xs text-muted-foreground">
                {t("confidence")}: {Math.round((selected.confidence ?? 0) * 100)}%
                · {t("source")}: {selected.generatedBy ?? "—"}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            {t("loading")}
          </div>
        ) : !selected ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            {t("empty")}
          </div>
        ) : (
          <div className="grid gap-4">
            {items.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {items.map((item) => (
                  <button
                    key={item.endpointId}
                    type="button"
                    onClick={() => selectEndpoint(item.endpointId)}
                    className={`rounded border px-2 py-1 font-mono text-xs transition-colors ${
                      item.endpointId === selectedId
                        ? "border-primary bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {item.method} {item.path}
                  </button>
                ))}
              </div>
            )}

            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <label className="text-sm font-medium">{t("capabilityName")}</label>
                <Input
                  value={capabilityName}
                  onChange={(e) => setCapabilityName(e.target.value)}
                  placeholder={t("capabilityNamePlaceholder")}
                />
              </div>
              <div className="grid gap-1.5">
                <label className="text-sm font-medium">{t("intent")}</label>
                <Textarea
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">{t("constraints")}</label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setConstraints((rows) => [
                        ...rows,
                        { type: "business_rule", rule: "" },
                      ])
                    }
                  >
                    <Plus className="mr-1 size-3.5" />
                    {t("addConstraint")}
                  </Button>
                </div>
                <div className="space-y-2">
                  {constraints.length === 0 && (
                    <p className="text-xs text-muted-foreground">{t("noConstraints")}</p>
                  )}
                  {constraints.map((row, index) => (
                    <div key={index} className="flex gap-2">
                      <select
                        value={row.type}
                        onChange={(e) =>
                          updateConstraint(index, { type: e.target.value })
                        }
                        className="h-9 rounded-md border bg-transparent px-2 text-sm"
                      >
                        {CONSTRAINT_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                      <Input
                        value={row.rule}
                        onChange={(e) =>
                          updateConstraint(index, { rule: e.target.value })
                        }
                        placeholder={t("rulePlaceholder")}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-9 shrink-0"
                        onClick={() =>
                          setConstraints((rows) =>
                            rows.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid gap-1.5">
                <label className="text-sm font-medium">{t("sideEffects")}</label>
                <Textarea
                  value={sideEffectsText}
                  onChange={(e) => setSideEffectsText(e.target.value)}
                  rows={2}
                  placeholder={t("lineSeparatedPlaceholder")}
                />
              </div>
              <div className="grid gap-1.5">
                <label className="text-sm font-medium">{t("usageScenarios")}</label>
                <Textarea
                  value={usageScenariosText}
                  onChange={(e) => setUsageScenariosText(e.target.value)}
                  rows={3}
                  placeholder={t("lineSeparatedPlaceholder")}
                />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setConfirmOpen(true)}
            disabled={!selected || regenerating}
          >
            <RefreshCw
              className={`mr-1.5 size-4 ${regenerating ? "animate-spin" : ""}`}
            />
            {regenerating ? t("generating") : t("regenerate")}
          </Button>
          <Button type="button" onClick={save} disabled={!selected || saving}>
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("regenerate")}
        description={t("confirmRegenerate")}
        confirmText={common("confirm")}
        cancelText={common("cancel")}
        destructive
        loading={regenerating}
        onConfirm={async () => {
          setConfirmOpen(false);
          await regenerate();
        }}
      />
    </Dialog>
  );
}
