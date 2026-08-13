"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Card,
  CardContent,
  Input,
} from "@apigent/ui";
import {
  AlertTriangle,
  ChevronRight,
  Folder,
  ListTree,
  Search,
  X,
} from "lucide-react";
import type { RepoEndpoint } from "@/services/repos";
import { SchemaTree } from "@/components/schema-tree";

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

/** 从 schema 对象提取可读的类型标签（$ref → 模型名）。 */
function schemaTypeLabel(schema: unknown): string | null {
  if (!schema || typeof schema !== "object") return null;
  const s = schema as Record<string, unknown>;
  if (typeof s.$ref === "string") {
    return s.$ref.split("/").pop() ?? s.$ref;
  }
  if (typeof s.type === "string") return s.type;
  if (Array.isArray(s.enum)) return `enum(${s.enum.join("|")})`;
  return null;
}

function matches(ep: RepoEndpoint, q: string): boolean {
  return (
    ep.path.toLowerCase().includes(q) ||
    (ep.summary ?? "").toLowerCase().includes(q) ||
    (ep.operationId ?? "").toLowerCase().includes(q)
  );
}

export function EndpointList({ endpoints }: { endpoints: RepoEndpoint[] }) {
  const t = useTranslations("repos.detail");
  const [query, setQuery] = React.useState("");
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = React.useState<string | null>(
    endpoints[0]?.id ?? null,
  );

  const q = query.trim().toLowerCase();
  const filtered = React.useMemo(
    () => endpoints.filter((ep) => !q || matches(ep, q)),
    [endpoints, q],
  );

  const groups = React.useMemo(() => {
    const map = new Map<string, RepoEndpoint[]>();
    for (const ep of filtered) {
      const key = ep.modules[0] ?? t("endpointsUngrouped");
      const list = map.get(key) ?? [];
      list.push(ep);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, t]);

  const selected =
    endpoints.find((ep) => ep.id === selectedId) ?? filtered[0] ?? null;

  if (endpoints.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <ListTree className="mb-4 size-12 text-muted-foreground/50" />
          <h3 className="mb-1 text-lg font-semibold">{t("endpointsEmpty")}</h3>
          <p className="max-w-md text-muted-foreground">
            {t("endpointsEmptyDesc")}
          </p>
        </CardContent>
      </Card>
    );
  }

  const toggleGroup = (name: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="flex h-[calc(100svh-10rem)] min-h-0 flex-col overflow-hidden rounded-lg border bg-card md:flex-row">
      {/* ── 左侧：接口树 ─────────────────────────────── */}
      <aside className="flex min-h-0 w-full shrink-0 flex-col border-b bg-muted/20 md:w-72 md:border-r md:border-b-0">
        <div className="flex items-center gap-2 border-b p-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("endpointsSearchPlaceholder")}
              className="h-8 pl-7 text-sm"
            />
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {t("endpointsCount", { count: filtered.length })}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <p className="text-sm text-muted-foreground">
                {t("endpointsNoResults")}
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
            <div className="space-y-1">
              {groups.map(([name, eps]) => {
                const isCollapsed = collapsed.has(name);
                return (
                  <div key={name}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(name)}
                      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-medium hover:bg-accent"
                    >
                      <ChevronRight
                        className={`size-3.5 text-muted-foreground transition-transform ${
                          isCollapsed ? "" : "rotate-90"
                        }`}
                      />
                      <Folder className="size-4 text-muted-foreground" />
                      <span className="truncate">{name}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {eps.length}
                      </span>
                    </button>
                    {!isCollapsed && (
                      <div className="ml-4 space-y-0.5 border-l pl-2">
                        {eps.map((ep) => (
                          <button
                            key={ep.id}
                            type="button"
                            onClick={() => setSelectedId(ep.id)}
                            className={`w-full rounded-md px-2 py-1.5 text-left transition-colors ${
                              selected?.id === ep.id
                                ? "bg-accent"
                                : "hover:bg-accent/60"
                            }`}
                          >
                            <span className="flex items-center gap-1.5">
                              <Badge
                                className={`shrink-0 px-1.5 text-[10px] ${methodStyle(
                                  ep.method,
                                )}`}
                              >
                                {ep.method}
                              </Badge>
                              <span className="truncate text-sm">
                                {ep.summary ?? ep.path}
                              </span>
                              {ep.deprecated && (
                                <AlertTriangle
                                  aria-label={t("endpointsDeprecated")}
                                  className="size-3 shrink-0 text-amber-500"
                                />
                              )}
                            </span>
                            <span className="mt-0.5 block truncate pl-8 font-mono text-xs text-muted-foreground">
                              {ep.path}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      {/* ── 右侧：接口详情面板 ───────────────────────── */}
      <section className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-background p-4 lg:p-6">
        {selected ? (
          <EndpointDetail endpoint={selected} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t("endpointsSelectHint")}
          </div>
        )}
      </section>
    </div>
  );
}

function EndpointDetail({ endpoint }: { endpoint: RepoEndpoint }) {
  const t = useTranslations("repos.detail");
  const parameters = (endpoint.parameters ?? []) as Record<
    string,
    unknown
  >[];

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={methodStyle(endpoint.method)}>
            {endpoint.method}
          </Badge>
          <code className="font-mono text-sm">{endpoint.path}</code>
          {endpoint.deprecated && (
            <Badge variant="destructive">{t("endpointsDeprecated")}</Badge>
          )}
        </div>
        <h2 className="mt-2 text-xl font-bold tracking-tight">
          {endpoint.summary ?? endpoint.path}
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {endpoint.operationId && (
            <span>
              {t("endpointsOperationId")}: {endpoint.operationId}
            </span>
          )}
          {endpoint.modules.map((m) => (
            <Badge key={m} variant="secondary">
              {m}
            </Badge>
          ))}
        </div>
      </div>

      {endpoint.description && (
        <div>
          <h3 className="mb-1.5 text-sm font-medium">
            {t("endpointsDescription")}
          </h3>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {endpoint.description}
          </p>
        </div>
      )}

      {/* 参数 */}
      <section>
        <h3 className="mb-2 text-sm font-semibold">
          {t("endpointsParameters")}
        </h3>
        {parameters.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("endpointsNoParameters")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{t("endpointsName")}</th>
                  <th className="px-3 py-2 font-medium">
                    {t("endpointsLocation")}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t("endpointsRequired")}
                  </th>
                  <th className="px-3 py-2 font-medium">{t("endpointsType")}</th>
                  <th className="px-3 py-2 font-medium">
                    {t("endpointsDescription")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {parameters.map((p, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-3 py-2 font-mono">{String(p.name ?? "")}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {String(p.in ?? "")}
                    </td>
                    <td className="px-3 py-2">
                      {p.required ? (
                        <Badge variant="destructive">
                          {t("endpointsRequired")}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">
                      {schemaTypeLabel(p.schema) ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {p.description ? String(p.description) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 请求体 */}
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          {t("endpointsRequestBody")}
          {endpoint.requestContentType ? (
            <Badge variant="secondary" className="font-mono text-xs">
              {endpoint.requestContentType}
            </Badge>
          ) : null}
        </h3>
        {endpoint.requestSchema ? (
          <SchemaRefView schemaRef={endpoint.requestSchema} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("endpointsNoRequestBody")}
          </p>
        )}
      </section>

      {/* 响应 */}
      <section>
        <h3 className="mb-2 text-sm font-semibold">
          {t("endpointsResponses")}
        </h3>
        {endpoint.responses.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("endpointsNoResponses")}
          </p>
        ) : (
          <div className="space-y-1.5">
            {endpoint.responses.map((r, i) => (
              <div
                key={`${r.statusCode}-${r.contentType ?? i}`}
                className="space-y-2 rounded-md border px-3 py-2"
              >
                <div className="flex items-start gap-2">
                  <Badge
                    variant={r.isError ? "destructive" : "outline"}
                    className="font-mono"
                  >
                    {r.statusCode}
                  </Badge>
                  {r.contentType ? (
                    <Badge variant="secondary" className="font-mono text-xs">
                      {r.contentType}
                    </Badge>
                  ) : null}
                  <span className="min-w-0 flex-1 text-sm text-muted-foreground">
                    {r.description || "—"}
                  </span>
                </div>
                {r.schema ? <SchemaRefView schemaRef={r.schema} /> : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SchemaRefView({ schemaRef }: { schemaRef: unknown }) {
  const t = useTranslations("repos.detail");
  const ref = schemaRef as
    | { schema?: unknown; ref?: string; unresolved?: boolean }
    | null;
  if (!ref) return null;
  if (ref.unresolved) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("endpointsUnresolved")}
      </p>
    );
  }
  if (ref.ref) {
    return (
      <code className="rounded bg-muted px-1.5 py-0.5 text-sm">{ref.ref}</code>
    );
  }
  if (ref.schema === undefined) {
    return <p className="text-sm text-muted-foreground">—</p>;
  }
  return <SchemaTree schema={ref.schema} />;
}
