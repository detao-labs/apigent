"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@apigent/ui";
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  Check,
  CheckCircle2,
  FileUp,
  KeyRound,
  ListTree,
  Loader2,
  Upload,
} from "lucide-react";

const MAX_SPEC_BYTES = 5 * 1024 * 1024;

interface ImportIssue {
  severity: "warning" | "error";
  apiId?: string;
  message: string;
}

interface PreviewData {
  openapiVersion: string;
  specTitle: string | null;
  specVersion: string | null;
  nextVersion: string;
  fatal: boolean;
  stats: { endpoints: number; models: number; modules: number };
  issues: ImportIssue[];
}

export function ImportVersionDialog({
  open,
  onOpenChange,
  repoId,
  repoName,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoId: string;
  repoName: string;
  onImported?: () => void;
}) {
  const t = useTranslations("repos.import");
  const [step, setStep] = React.useState<"input" | "preview" | "done">("input");
  const [mode, setMode] = React.useState<"file" | "paste">("file");
  const [content, setContent] = React.useState("");
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<PreviewData | null>(null);
  const [result, setResult] = React.useState<{
    version: string;
    stats: PreviewData["stats"];
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) return;
    setStep("input");
    setMode("file");
    setContent("");
    setFileName(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setBusy(false);
  }, [open]);

  const size = new TextEncoder().encode(content).length;
  const tooLarge = size > MAX_SPEC_BYTES;

  async function selectFile(file: File) {
    if (file.size > MAX_SPEC_BYTES) {
      setFileName(file.name);
      setContent("");
      setError(t("tooLarge"));
      return;
    }
    setError(null);
    setFileName(file.name);
    setContent(await file.text());
  }

  async function parse() {
    if (!content.trim()) {
      setError(t("noContent"));
      return;
    }
    if (tooLarge) {
      setError(t("tooLarge"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/repos/${repoId}/imports/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = (await res.json().catch(() => null)) as {
        preview?: PreviewData;
      } | null;
      if (!res.ok || !data?.preview) {
        setError(t("parseFailed"));
        return;
      }
      setPreview(data.preview);
      setStep("preview");
    } catch {
      setError(t("parseFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/repos/${repoId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = (await res.json().catch(() => null)) as {
        version?: { version: string; stats: PreviewData["stats"] };
      } | null;
      if (!res.ok || !data?.version) {
        setError(t("importFailed"));
        return;
      }
      setResult(data.version);
      setStep("done");
      onImported?.();
    } catch {
      setError(t("importFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("subtitle", { repo: repoName })}
          </DialogDescription>
        </DialogHeader>

        {step === "input" && (
          <div className="space-y-4">
            <div className="flex gap-1 rounded-lg bg-muted p-1">
              {(["file", "paste"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
                    mode === m
                      ? "bg-background font-medium shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "file" ? t("upload") : t("paste")}
                </button>
              ))}
            </div>

            {mode === "file" ? (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) void selectFile(file);
                }}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-10 text-center transition-colors hover:border-primary/50 hover:bg-muted/30"
              >
                <FileUp className="size-8 text-muted-foreground" />
                <p className="text-sm font-medium">{t("uploadHint")}</p>
                <p className="text-xs text-muted-foreground">{t("sizeLimit")}</p>
                {fileName && (
                  <Badge variant="secondary" className="mt-1">
                    {fileName}
                  </Badge>
                )}
              </button>
            ) : (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={10}
                placeholder={t("pastePlaceholder")}
                className="w-full rounded-md border border-input bg-transparent p-3 font-mono text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".json,.yaml,.yml,application/json,text/yaml,text/plain"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void selectFile(file);
                e.target.value = "";
              }}
            />
            {content && (
              <p className="text-right text-xs text-muted-foreground">
                {Math.ceil(size / 1024)} KB
              </p>
            )}
          </div>
        )}

        {step === "preview" && preview && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t("specVersion")}</span>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {preview.specVersion ?? t("unknownVersion")}
              </code>
              <span className="text-muted-foreground">{t("next")}</span>
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {preview.nextVersion}
              </code>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: t("stats.endpoints"), value: preview.stats.endpoints, icon: ListTree },
                { label: t("stats.models"), value: preview.stats.models, icon: Boxes },
                { label: t("stats.modules"), value: preview.stats.modules, icon: Upload },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-lg border bg-muted/30 p-3 text-center"
                >
                  <stat.icon className="mx-auto mb-1 size-4 text-muted-foreground" />
                  <div className="text-xl font-bold">{stat.value}</div>
                  <div className="text-xs text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </div>

            <div>
              <p className="mb-1.5 text-sm font-medium">{t("issues")}</p>
              {preview.issues.length === 0 ? (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CheckCircle2 className="size-4 text-primary" />
                  {t("noIssues")}
                </p>
              ) : (
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {preview.issues.map((issue, i) => (
                    <li
                      key={i}
                      className={`flex items-start gap-1.5 rounded px-2 py-1 text-xs ${
                        issue.severity === "error"
                          ? "bg-destructive/10 text-destructive"
                          : "bg-amber-100/60 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
                      }`}
                    >
                      <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                      <span>
                        {issue.apiId && (
                          <code className="mr-1 font-mono">{issue.apiId}</code>
                        )}
                        {issue.message}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {preview.fatal && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-destructive">
                  <AlertTriangle className="size-4" />
                  {t("errorsBlock")}
                </p>
              )}
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="flex flex-col items-center py-4 text-center">
            <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
              <Check className="size-6" />
            </span>
            <h3 className="text-base font-semibold">{t("success")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("successDesc", { version: result.version })}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link
                href={`/repos/${repoId}/endpoints`}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <ListTree className="size-4" />
                {t("viewEndpoints")}
              </Link>
              <Link
                href="/settings?section=keys"
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
              >
                <KeyRound className="size-4" />
                {t("generateKey")}
              </Link>
            </div>
          </div>
        )}

        {error && (
          <p className="flex items-center gap-1.5 text-sm text-destructive">
            <AlertTriangle className="size-4" />
            {error}
          </p>
        )}

        <DialogFooter>
          {step === "input" && (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                onClick={parse}
                disabled={busy || !content.trim() || tooLarge}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                {busy ? t("parsing") : t("parse")}
              </Button>
            </>
          )}
          {step === "preview" && preview && (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep("input")}
                disabled={busy}
              >
                <ArrowLeft className="size-4" />
                {t("back")}
              </Button>
              <Button
                type="button"
                onClick={confirmImport}
                disabled={busy || preview.fatal}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                {busy ? t("importing") : t("confirm")}
              </Button>
            </>
          )}
          {step === "done" && (
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t("done")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
