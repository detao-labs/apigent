"use client";

// ═══════════════════════════════════════════════════════════════════
// ContextManagement — 业务上下文管理列表（repos/[id]/context）
// ═══════════════════════════════════════════════════════════════════
//
// 当前版本所有接口的上下文状态；行点击打开全局编辑对话框；
// "全部生成"触发批量生成任务并轮询状态。
// ═══════════════════════════════════════════════════════════════════

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardContent,
} from "@apigent/ui";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import type { EndpointContextSummary } from "@/services/contexts";
import type { ContextTaskSummary } from "@apigent/server/contexts";
import { useOpenBusinessContext } from "@/hooks/use-open-business-context";

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

export function ContextManagement({ repoId }: { repoId: string }) {
  const t = useTranslations("contexts");
  const openBusinessContext = useOpenBusinessContext();
  const [items, setItems] = React.useState<EndpointContextSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [generating, setGenerating] = React.useState(false);
  const [task, setTask] = React.useState<ContextTaskSummary | null>(null);

  async function refresh() {
    const res = await fetch(`/api/repos/${repoId}/contexts`, {
      cache: "no-store",
    });
    const data = (await res.json()) as { contexts: EndpointContextSummary[] };
    setItems(data.contexts);
  }

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/repos/${repoId}/contexts`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { contexts: EndpointContextSummary[] }) => {
        if (!cancelled) setItems(data.contexts);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoId]);

  async function generateAll() {
    setGenerating(true);
    try {
      const res = await fetch(`/api/repos/${repoId}/contexts/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { task?: ContextTaskSummary };
      const taskId = data.task?.taskId;
      const started = Date.now();
      while (taskId && Date.now() - started < 10 * 60 * 1000) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const taskRes = await fetch(
          `/api/repos/${repoId}/context-tasks/latest`,
          { cache: "no-store" },
        );
        const taskData = (await taskRes.json()) as {
          task?: ContextTaskSummary;
        };
        const latest = taskData.task;
        setTask(latest ?? null);
        if (
          latest &&
          (latest.status === "succeeded" || latest.status === "failed")
        ) {
          break;
        }
      }
      await refresh();
      toast.success(t("regenerated"));
    } catch {
      toast.error(t("generateFailed"));
    } finally {
      setGenerating(false);
    }
  }

  const generatingTask =
    task && (task.status === "queued" || task.status === "running");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t("subtitle")}
          {generatingTask && task && (
            <span className="ml-2 text-xs">
              {t("generating")} {task.progress}%
            </span>
          )}
        </p>
        <Button type="button" onClick={generateAll} disabled={generating}>
          <RefreshCw
            className={`mr-1.5 size-4 ${generating ? "animate-spin" : ""}`}
          />
          {generating ? t("generating") : t("regenerate")}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              {t("loading")}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Sparkles className="mb-3 size-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
            </div>
          ) : (
            <div className="divide-y">
              {items.map((item) => {
                const hasContext = Boolean(item.capabilityName);
                const status = !hasContext
                  ? "notGenerated"
                  : item.needsReview
                    ? "needsReview"
                    : item.editedByHuman
                      ? "humanEdited"
                      : "generated";
                return (
                  <button
                    key={item.endpointId}
                    type="button"
                    onClick={() =>
                      openBusinessContext({
                        repoId,
                        endpointId: item.endpointId,
                      })
                    }
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                  >
                    <span
                      className={`w-16 shrink-0 rounded px-1.5 py-0.5 text-center font-mono text-xs ${methodStyle(item.method)}`}
                    >
                      {item.method}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-sm">
                        {item.path}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.capabilityName ?? item.summary ?? "—"}
                      </span>
                    </span>
                    {hasContext && (
                      <span className="hidden text-xs text-muted-foreground sm:block">
                        {Math.round((item.confidence ?? 0) * 100)}%
                      </span>
                    )}
                    <Badge
                      variant={
                        status === "needsReview"
                          ? "default"
                          : status === "humanEdited"
                            ? "secondary"
                            : status === "generated"
                              ? "default"
                              : "outline"
                      }
                    >
                      {t(status)}
                    </Badge>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
