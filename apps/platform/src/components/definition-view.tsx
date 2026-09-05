"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { Badge, Card, CardContent, Input } from "@apigent/ui";
import {
  Boxes,
  ChevronRight,
  Component,
  Folder,
  ListTree,
  Search,
} from "lucide-react";
import { SchemaTree } from "@/components/schema-tree";
import type {
  RepoComponentDef,
  RepoDataModel,
  RepoEndpoint,
} from "@/services/repos";

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

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function DefinitionView({
  repoId,
  endpoints,
  models,
  components,
}: {
  repoId: string;
  endpoints: RepoEndpoint[];
  models: RepoDataModel[];
  components: RepoComponentDef[];
}) {
  const t = useTranslations("repos.detail");
  const d = useTranslations("repos.detail.definitions");
  const router = useRouter();
  const params = useParams<{ endpointId?: string; schemaId?: string; componentId?: string }>();

  const initialType = params.endpointId
    ? "ep"
    : params.schemaId
      ? "model"
      : params.componentId
        ? "comp"
        : null;
  const initialId = params.endpointId ?? params.schemaId ?? params.componentId ?? null;
  const selectedKey =
    initialType && initialId ? `${initialType}:${initialId}` : null;

  const [selected, setSelected] = React.useState<string | null>(selectedKey);
  const [query, setQuery] = React.useState("");
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    if (!selectedKey) return;
    setSelected(selectedKey);
    openGroupFor(selectedKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const q = query.trim().toLowerCase();
  const filteredEndpoints = endpoints.filter(
    (ep) =>
      !q ||
      ep.path.toLowerCase().includes(q) ||
      (ep.summary ?? "").toLowerCase().includes(q) ||
      (ep.operationId ?? "").toLowerCase().includes(q),
  );
  const filteredModels = models.filter(
    (m) =>
      !q ||
      m.name.toLowerCase().includes(q) ||
      (m.description ?? "").toLowerCase().includes(q),
  );
  const filteredComponents = components.filter(
    (c) =>
      !q ||
      c.name.toLowerCase().includes(q) ||
      (c.description ?? "").toLowerCase().includes(q),
  );

  const endpointGroups = React.useMemo(() => {
    const map = new Map<string, RepoEndpoint[]>();
    for (const ep of filteredEndpoints) {
      const key = ep.modules[0] ?? d("ungrouped");
      const list = map.get(key) ?? [];
      list.push(ep);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredEndpoints, d]);

  const componentGroups = React.useMemo(() => {
    const map = new Map<string, RepoComponentDef[]>();
    for (const c of filteredComponents) {
      const key = d(`kind${cap(c.kind)}`);
      const list = map.get(key) ?? [];
      list.push(c);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredComponents, d]);

  const toggleGroup = (key: string) =>
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  const groupOpen = (key: string) => !collapsed[key];

  function select(key: string) {
    setSelected(key);
    const [type, id] = key.split(":");
    const segment =
      type === "ep"
        ? `endpoints/${id}`
        : type === "model"
          ? `schemas/${id}`
          : `components/${id}`;
    router.replace(`/repos/${repoId}/definition/${segment}`);
  }

  function openGroupFor(key: string) {
    const [type, id] = key.split(":");
    setCollapsed((prev) => {
      const next = { ...prev };
      if (type === "ep") {
        const ep = endpoints.find((x) => x.id === id);
        const module = ep?.modules[0] ?? d("ungrouped");
        next["ep"] = false;
        next[`ep-${module}`] = false;
      } else if (type === "model") {
        next["models"] = false;
      } else if (type === "comp") {
        const c = components.find((x) => x.id === id);
        const kindLabel = c ? d(`kind${cap(c.kind)}`) : null;
        next["components"] = false;
        if (kindLabel) next[`comp-${kindLabel}`] = false;
      }
      return next;
    });
  }

  function selectModelByName(name: string) {
    const m = models.find((x) => x.name === name);
    if (m) {
      setSelected(`model:${m.id}`);
      router.replace(`/repos/${repoId}/definition/schemas/${m.id}`);
    }
  }

  function renderDetail() {
    if (!selected) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {d("selectHint")}
        </div>
      );
    }
    const [type, id] = selected.split(":");
    if (type === "ep") {
      const ep = endpoints.find((x) => x.id === id);
      return ep ? (
        <EndpointDetail ep={ep} onSelectModel={selectModelByName} />
      ) : (
        <DetailMissing d={d} />
      );
    }
    if (type === "model") {
      const m = models.find((x) => x.id === id);
      return m ? <ModelDetail m={m} d={d} /> : <DetailMissing d={d} />;
    }
    const c = components.find((x) => x.id === id);
    return c ? (
      <ComponentDetail c={c} d={d} onSelectModel={selectModelByName} />
    ) : (
      <DetailMissing d={d} />
    );
  }

  return (
    <div className="flex h-[calc(100svh-12rem)] min-h-0 flex-col overflow-hidden rounded-lg border bg-card md:flex-row">
      {/* 左：树 */}
      <aside className="flex min-h-0 w-full shrink-0 flex-col border-b bg-muted/20 md:w-80 md:border-r md:border-b-0">
        <div className="flex items-center gap-2 border-b p-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={d("search")}
              className="h-8 pl-7 text-sm"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {/* 接口 */}
          <TreeGroup
            label={d("groupEndpoints")}
            icon={<ListTree className="size-3.5" />}
            count={filteredEndpoints.length}
            open={groupOpen("ep")}
            onToggle={() => toggleGroup("ep")}
          >
            {endpointGroups.map(([name, eps]) => (
              <div key={name}>
                <button
                  type="button"
                  onClick={() => toggleGroup(`ep-${name}`)}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium text-muted-foreground hover:bg-accent"
                >
                  <ChevronRight
                    className={`size-3 transition-transform ${groupOpen(`ep-${name}`) ? "rotate-90" : ""}`}
                  />
                  <Folder className="size-3.5" />
                  <span className="truncate">{name}</span>
                  <span className="ml-auto text-xs">{eps.length}</span>
                </button>
                {groupOpen(`ep-${name}`) && (
                  <div className="ml-4 space-y-0.5 border-l pl-2">
                    {eps.map((ep) => (
                      <TreeNode
                        key={ep.id}
                        active={selected === `ep:${ep.id}`}
                        onClick={() => select(`ep:${ep.id}`)}
                        icon={
                          <Badge
                            className={`shrink-0 px-1.5 text-[10px] ${methodStyle(ep.method)}`}
                          >
                            {ep.method}
                          </Badge>
                        }
                        title={ep.summary ?? ep.path}
                        subtitle={ep.path}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </TreeGroup>

          {/* 数据模型 */}
          <TreeGroup
            label={d("groupModels")}
            icon={<Boxes className="size-3.5" />}
            count={filteredModels.length}
            open={groupOpen("models")}
            onToggle={() => toggleGroup("models")}
          >
            <div className="ml-4 space-y-0.5 border-l pl-2">
              {filteredModels.map((m) => (
                <TreeNode
                  key={m.id}
                  active={selected === `model:${m.id}`}
                  onClick={() => select(`model:${m.id}`)}
                  icon={<Boxes className="size-3.5 text-muted-foreground" />}
                  title={m.name}
                  subtitle={`${m.schemaType ?? ""} · ${m.description ?? ""}`}
                />
              ))}
            </div>
          </TreeGroup>

          {/* 组件库 */}
          <TreeGroup
            label={d("groupComponents")}
            icon={<Component className="size-3.5" />}
            count={filteredComponents.length}
            open={groupOpen("components")}
            onToggle={() => toggleGroup("components")}
          >
            {componentGroups.map(([name, comps]) => (
              <div key={name}>
                <button
                  type="button"
                  onClick={() => toggleGroup(`comp-${name}`)}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium text-muted-foreground hover:bg-accent"
                >
                  <ChevronRight
                    className={`size-3 transition-transform ${groupOpen(`comp-${name}`) ? "rotate-90" : ""}`}
                  />
                  <Folder className="size-3.5" />
                  <span className="truncate">{name}</span>
                  <span className="ml-auto text-xs">{comps.length}</span>
                </button>
                {groupOpen(`comp-${name}`) && (
                  <div className="ml-4 space-y-0.5 border-l pl-2">
                    {comps.map((c) => (
                      <TreeNode
                        key={c.id}
                        active={selected === `comp:${c.id}`}
                        onClick={() => select(`comp:${c.id}`)}
                        icon={<Component className="size-3.5 text-muted-foreground" />}
                        title={c.name}
                        subtitle={c.defType ?? c.description ?? ""}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </TreeGroup>
        </div>
      </aside>

      {/* 右：详情 */}
      <section className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-background p-4 lg:p-6">
        {renderDetail()}
      </section>
    </div>
  );
}

function TreeGroup({
  label,
  icon,
  count,
  open,
  onToggle,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const d = useTranslations("repos.detail.definitions");
  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-semibold text-foreground hover:bg-accent"
      >
        <ChevronRight
          className={`size-3.5 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
        />
        {icon}
        <span className="truncate">{label}</span>
        <Badge variant="secondary" className="ml-auto text-[10px]">
          {count}
        </Badge>
        <span className="sr-only">{d("selectHint")}</span>
      </button>
      {open && <div className="mt-0.5">{children}</div>}
    </div>
  );
}

function TreeNode({
  active,
  onClick,
  icon,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
        active ? "bg-accent" : "hover:bg-accent/60"
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{title}</span>
        <span className="block truncate text-xs font-mono text-muted-foreground">
          {subtitle}
        </span>
      </span>
    </button>
  );
}

function EndpointDetail({
  ep,
  onSelectModel,
}: {
  ep: RepoEndpoint;
  onSelectModel: (name: string) => void;
}) {
  const t = useTranslations("repos.detail");
  const parameters = (ep.parameters ?? []) as Record<string, unknown>[];
  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={methodStyle(ep.method)}>{ep.method}</Badge>
          <code className="font-mono text-sm">{ep.path}</code>
          {ep.deprecated && (
            <Badge variant="destructive">{t("endpointsDeprecated")}</Badge>
          )}
        </div>
        <h2 className="mt-2 text-xl font-bold tracking-tight">
          {ep.summary ?? ep.path}
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {ep.operationId && (
            <span>{t("endpointsOperationId")}: {ep.operationId}</span>
          )}
          {ep.modules.map((m) => (
            <Badge key={m} variant="secondary">
              {m}
            </Badge>
          ))}
        </div>
      </div>

      {ep.description && (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
          {ep.description}
        </p>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold">{t("endpointsParameters")}</h3>
        {parameters.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("endpointsNoParameters")}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{t("endpointsName")}</th>
                  <th className="px-3 py-2 font-medium">{t("endpointsLocation")}</th>
                  <th className="px-3 py-2 font-medium">{t("endpointsRequired")}</th>
                  <th className="px-3 py-2 font-medium">{t("endpointsType")}</th>
                  <th className="px-3 py-2 font-medium">{t("endpointsDescription")}</th>
                </tr>
              </thead>
              <tbody>
                {parameters.map((p, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-3 py-2 font-mono">{String(p.name ?? "")}</td>
                    <td className="px-3 py-2 text-muted-foreground">{String(p.in ?? "")}</td>
                    <td className="px-3 py-2">
                      {p.required ? (
                        <Badge variant="destructive">{t("endpointsRequired")}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">—</td>
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

      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          {t("endpointsRequestBody")}
          {ep.requestContentType && (
            <Badge variant="secondary" className="font-mono text-xs">
              {ep.requestContentType}
            </Badge>
          )}
        </h3>
        {ep.requestSchema ? (
          <SchemaRefView schemaRef={ep.requestSchema} onSelectModel={onSelectModel} />
        ) : (
          <p className="text-sm text-muted-foreground">{t("endpointsNoRequestBody")}</p>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">{t("endpointsResponses")}</h3>
        {ep.responses.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("endpointsNoResponses")}</p>
        ) : (
          <div className="space-y-1.5">
            {ep.responses.map((r, i) => (
              <div key={`${r.statusCode}-${i}`} className="rounded-md border px-3 py-2">
                <div className="flex items-center gap-2">
                  <Badge variant={r.isError ? "destructive" : "outline"} className="font-mono">
                    {r.statusCode}
                  </Badge>
                  {r.contentType && (
                    <Badge variant="secondary" className="font-mono text-xs">
                      {r.contentType}
                    </Badge>
                  )}
                  <span className="text-sm text-muted-foreground">
                    {r.description || "—"}
                  </span>
                </div>
                {r.schema ? (
                  <SchemaRefView schemaRef={r.schema} onSelectModel={onSelectModel} />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ModelDetail({
  m,
  d,
}: {
  m: RepoDataModel;
  d: (key: string) => string;
}) {
  const raw = m.schemaRaw ?? {};
  const fieldCount = raw.properties ? Object.keys(raw.properties).length : 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-mono text-base font-semibold">{m.name}</h2>
        <Badge variant="secondary">{m.schemaType ?? "object"}</Badge>
        {fieldCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {d("fieldCount")}: {fieldCount}
          </span>
        )}
      </div>
      {m.description && (
        <p className="text-sm text-muted-foreground">{m.description}</p>
      )}
      <SchemaTree schema={raw} />
    </div>
  );
}

function ComponentDetail({
  c,
  d,
  onSelectModel,
}: {
  c: RepoComponentDef;
  d: (key: string) => string;
  onSelectModel: (name: string) => void;
}) {
  const t = useTranslations("repos.detail");
  const p = c.payload ?? {};
  const schema = p.schema as Record<string, unknown> | undefined;

  function row(label: string, value: React.ReactNode) {
    return (
      <div className="flex gap-4 border-b py-2 text-sm last:border-0">
        <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
        <span className="min-w-0 flex-1">{value}</span>
      </div>
    );
  }

  const kindLabel = d(`detail${cap(c.kind)}`);
  const meta: React.ReactNode[] = [];
  if (c.defType) meta.push(row("Type", <code className="font-mono">{c.defType}</code>));
  if (c.description) meta.push(row(t("endpointsDescription"), c.description));

  if (c.kind === "securityScheme") {
    if (typeof p.in === "string") meta.push(row("In", p.in));
    if (typeof p.scheme === "string") meta.push(row("Scheme", <code className="font-mono">{p.scheme}</code>));
    if (typeof p.bearerFormat === "string") meta.push(row("Bearer format", p.bearerFormat));
    if (p.flows) meta.push(row("Flows", <code className="font-mono">OAuth2</code>));
  } else if (c.kind === "parameter") {
    if (typeof p.name === "string") meta.push(row("Name", <code className="font-mono">{p.name}</code>));
  } else if (c.kind === "response") {
    if (typeof p.contentType === "string") meta.push(row("Media type", <code className="font-mono">{p.contentType}</code>));
  } else if (c.kind === "requestBody") {
    const content = p.content as Record<string, unknown> | undefined;
    if (content) meta.push(row("Media type", Object.keys(content).join(", ")));
  } else if (c.kind === "link") {
    if (typeof p.operationId === "string") {
      meta.push(row("operationId", <code className="font-mono">{p.operationId}</code>));
    }
    if (typeof p.operationRef === "string") {
      meta.push(row("operationRef", <code className="font-mono">{p.operationRef}</code>));
    }
    if (p.parameters) {
      meta.push(row("Parameters", <code className="font-mono">{JSON.stringify(p.parameters)}</code>));
    }
  } else if (c.kind === "callback") {
    const expressions = Object.keys(p).filter(
      (k) => k.includes("{") || k.includes("$"),
    );
    if (expressions.length) {
      meta.push(row("Runtime URL", <code className="font-mono">{expressions.join(", ")}</code>));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-mono text-base font-semibold">{c.name}</h2>
        <Badge variant="secondary">{kindLabel}</Badge>
      </div>
      <Card>
        <CardContent className="p-0">
          {meta.length ? meta : <p className="px-4 py-3 text-sm text-muted-foreground">—</p>}
        </CardContent>
      </Card>
      {schema ? (
        <SchemaRefView schemaRef={schema} onSelectModel={onSelectModel} />
      ) : null}
    </div>
  );
}

function SchemaRefView({
  schemaRef,
  onSelectModel,
}: {
  schemaRef: unknown;
  onSelectModel?: (name: string) => void;
}) {
  const t = useTranslations("repos.detail");
  const any = (schemaRef ?? null) as Record<string, unknown> | null;
  if (!any) return null;
  if (any.unresolved === true) {
    return <p className="text-sm text-muted-foreground">{t("endpointsUnresolved")}</p>;
  }
  if (typeof any.ref === "string") {
    const name = String(any.ref).split("/").pop() ?? String(any.ref);
    return (
      <button
        type="button"
        onClick={() => onSelectModel?.(name)}
        className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-sm hover:bg-accent"
      >
        <Boxes className="size-3.5" />
        {String(any.ref)}
      </button>
    );
  }
  if (typeof any.schema !== "undefined") return <SchemaTree schema={any.schema} />;
  return <SchemaTree schema={any} />;
}

function DetailMissing({ d }: { d: (key: string) => string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {d("selectHint")}
    </div>
  );
}
