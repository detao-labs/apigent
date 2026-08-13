"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Card,
  CardContent,
  Input,
} from "@apigent/ui";
import { Boxes, Search, X } from "lucide-react";
import type { RepoDataModel } from "@/services/repos";
import { SchemaTree } from "@/components/schema-tree";

interface RawSchema {
  type?: string | null;
  properties?: Record<string, unknown>;
  required?: string[];
}

function typeLabel(schema: unknown): string {
  if (!schema || typeof schema !== "object") return "—";
  const s = schema as Record<string, unknown>;
  if (typeof s.$ref === "string") return s.$ref.split("/").pop() ?? s.$ref;
  if (typeof s.type === "string") {
    if (s.type === "array" && s.items && typeof s.items === "object") {
      return `array<${typeLabel(s.items)}>`;
    }
    return s.type;
  }
  return "—";
}

function propertyCount(schema: RawSchema): number {
  return schema.properties ? Object.keys(schema.properties).length : 0;
}

export function DataModelList({
  models,
}: {
  models: RepoDataModel[];
}) {
  const t = useTranslations("repos.detail");
  const [query, setQuery] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(
    models[0]?.id ?? null,
  );

  const q = query.trim().toLowerCase();
  const filtered = React.useMemo(
    () =>
      models.filter(
        (m) =>
          !q ||
          m.name.toLowerCase().includes(q) ||
          (m.description ?? "").toLowerCase().includes(q),
      ),
    [models, q],
  );
  const selected =
    models.find((m) => m.id === selectedId) ?? filtered[0] ?? null;

  if (models.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Boxes className="mb-4 size-12 text-muted-foreground/50" />
          <h3 className="mb-1 text-lg font-semibold">{t("schemasEmpty")}</h3>
          <p className="max-w-md text-muted-foreground">
            {t("schemasEmptyDesc")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex h-[calc(100svh-10rem)] min-h-0 flex-col overflow-hidden rounded-lg border bg-card md:flex-row">
      {/* ── 左侧：模型列表 ─────────────────────────────── */}
      <aside className="flex min-h-0 w-full shrink-0 flex-col border-b bg-muted/20 md:w-72 md:border-r md:border-b-0">
        <div className="flex items-center gap-2 border-b p-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("schemasSearchPlaceholder")}
              className="h-8 pl-7 text-sm"
            />
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {t("schemasCount", { count: filtered.length })}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <p className="text-sm text-muted-foreground">
                {t("schemasNoResults")}
              </p>
              <button
                type="button"
                onClick={() => setQuery("")}
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <X className="size-3.5" />
                {t("clearFilters")}
              </button>
            </div>
          ) : (
            <div className="space-y-0.5">
              {filtered.map((m) => {
                const raw = (m.schemaRaw ?? {}) as RawSchema;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedId(m.id)}
                    className={`w-full rounded-md px-2 py-1.5 text-left transition-colors ${
                      selected?.id === m.id
                        ? "bg-accent"
                        : "hover:bg-accent/60"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-mono text-sm font-medium">
                        {m.name}
                      </span>
                      <Badge
                        variant="secondary"
                        className="ml-auto shrink-0 px-1.5 text-[10px]"
                      >
                        {m.schemaType ?? typeLabel(raw)}
                      </Badge>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="truncate">
                        {m.description ?? "—"}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {propertyCount(raw)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      {/* ── 右侧：模型详情面板 ───────────────────────── */}
      <section className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-background p-4 lg:p-6">
        {selected ? (
          <DataModelDetail model={selected} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t("schemasSelectHint")}
          </div>
        )}
      </section>
    </div>
  );
}

function DataModelDetail({ model }: { model: RepoDataModel }) {
  const t = useTranslations("repos.detail");
  const raw = (model.schemaRaw ?? {}) as RawSchema;
  const fieldCount = propertyCount(raw);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-mono text-base font-semibold">{model.name}</h2>
        <Badge variant="secondary">
          {model.schemaType ?? typeLabel(raw)}
        </Badge>
        {fieldCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {t("schemasFieldCount")}: {fieldCount}
          </span>
        )}
      </div>
      {model.description && (
        <p className="text-sm text-muted-foreground">{model.description}</p>
      )}

      <SchemaTree schema={raw} />
    </div>
  );
}
