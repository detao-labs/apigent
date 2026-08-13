"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Card,
  CardContent,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@apigent/ui";
import { AlertTriangle, ListTree, Search, X } from "lucide-react";
import type { RepoEndpoint } from "@/services/repos";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

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

function prettySchema(schema: unknown): string {
  if (schema === null || schema === undefined) return "";
  return JSON.stringify(schema, null, 2);
}

export function EndpointList({ endpoints }: { endpoints: RepoEndpoint[] }) {
  const t = useTranslations("repos.detail");
  const [query, setQuery] = React.useState("");
  const [method, setMethod] = React.useState("all");
  const [selected, setSelected] = React.useState<RepoEndpoint | null>(null);

  const filtered = endpoints.filter((ep) => {
    const q = query.trim().toLowerCase();
    const matchesQuery =
      !q ||
      ep.path.toLowerCase().includes(q) ||
      (ep.summary ?? "").toLowerCase().includes(q) ||
      (ep.operationId ?? "").toLowerCase().includes(q);
    const matchesMethod = method === "all" || ep.method === method;
    return matchesQuery && matchesMethod;
  });

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

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("endpointsSearchPlaceholder")}
            className="pl-8"
          />
        </div>
        <select
          aria-label={t("endpointsAllMethods")}
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="all">{t("endpointsAllMethods")}</option>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <p className="text-sm text-muted-foreground">
          {t("endpointsCount", { count: filtered.length })}
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <p className="text-muted-foreground">{t("endpointsNoResults")}</p>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setMethod("all");
                }}
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <X className="size-3.5" />
                {t("clearFilters")}
              </button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-24">{t("endpointsMethod")}</TableHead>
                  <TableHead>{t("endpointsPath")}</TableHead>
                  <TableHead>{t("endpointsSummary")}</TableHead>
                  <TableHead className="hidden lg:table-cell">
                    {t("endpointsModules")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((ep) => (
                  <TableRow
                    key={ep.id}
                    className="cursor-pointer"
                    onClick={() => setSelected(ep)}
                  >
                    <TableCell>
                      <Badge className={methodStyle(ep.method)}>
                        {ep.method}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <code className="font-mono text-sm">{ep.path}</code>
                        {ep.deprecated && (
                          <AlertTriangle
                            aria-label={t("endpointsDeprecated")}
                            className="size-3.5 text-amber-500"
                          />
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="line-clamp-1 text-sm">
                        {ep.summary ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <span className="flex flex-wrap gap-1">
                        {ep.modules.length === 0 ? (
                          <span className="text-sm text-muted-foreground">
                            —
                          </span>
                        ) : (
                          ep.modules.map((m) => (
                            <Badge key={m} variant="secondary">
                              {m}
                            </Badge>
                          ))
                        )}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {selected && <EndpointDetail endpoint={selected} />}
        </SheetContent>
      </Sheet>
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
    <>
      <SheetHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={methodStyle(endpoint.method)}>
            {endpoint.method}
          </Badge>
          <code className="font-mono text-sm">{endpoint.path}</code>
        </div>
        <SheetTitle>{endpoint.summary ?? endpoint.path}</SheetTitle>
        {endpoint.operationId && (
          <SheetDescription>
            {t("endpointsOperationId")}: {endpoint.operationId}
          </SheetDescription>
        )}
      </SheetHeader>

      <div className="space-y-5 px-4 pb-6">
        {(endpoint.modules.length > 0 || endpoint.deprecated) && (
          <div className="flex flex-wrap items-center gap-2">
            {endpoint.modules.map((m) => (
              <Badge key={m} variant="secondary">
                {m}
              </Badge>
            ))}
            {endpoint.deprecated && (
              <Badge variant="destructive">{t("endpointsDeprecated")}</Badge>
            )}
          </div>
        )}

        {endpoint.description && (
          <div>
            <h4 className="mb-1.5 text-sm font-medium">
              {t("endpointsDescription")}
            </h4>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {endpoint.description}
            </p>
          </div>
        )}

        <div>
          <h4 className="mb-1.5 text-sm font-medium">
            {t("endpointsParameters")}
          </h4>
          {parameters.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("endpointsNoParameters")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("endpointsName")}</TableHead>
                    <TableHead>{t("endpointsLocation")}</TableHead>
                    <TableHead>{t("endpointsRequired")}</TableHead>
                    <TableHead>{t("endpointsType")}</TableHead>
                    <TableHead>{t("endpointsDescription")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parameters.map((p, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-sm">
                        {String(p.name ?? "")}
                      </TableCell>
                      <TableCell className="text-sm">
                        {String(p.in ?? "")}
                      </TableCell>
                      <TableCell>
                        {p.required ? (
                          <Badge variant="destructive">
                            {t("endpointsRequired")}
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {schemaTypeLabel(p.schema) ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {p.description ? String(p.description) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <div>
          <h4 className="mb-1.5 text-sm font-medium">
            {t("endpointsRequestBody")}
          </h4>
          {endpoint.requestSchema ? (
            <SchemaRefView schemaRef={endpoint.requestSchema} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("endpointsNoRequestBody")}
            </p>
          )}
        </div>

        <div>
          <h4 className="mb-1.5 text-sm font-medium">
            {t("endpointsResponses")}
          </h4>
          {endpoint.responses.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("endpointsNoResponses")}
            </p>
          ) : (
            <div className="space-y-1.5">
              {endpoint.responses.map((r) => (
                <div
                  key={r.statusCode}
                  className="flex items-start gap-2 rounded-md border px-3 py-2"
                >
                  <Badge
                    variant={r.isError ? "destructive" : "outline"}
                    className="font-mono"
                  >
                    {r.statusCode}
                  </Badge>
                  <span className="min-w-0 flex-1 text-sm text-muted-foreground">
                    {r.description || "—"}
                  </span>
                  {r.content ? (
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {Object.keys(r.content as Record<string, unknown>).join(
                        ", ",
                      )}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function SchemaRefView({ schemaRef }: { schemaRef: unknown }) {
  const t = useTranslations("repos.detail");
  const ref = schemaRef as
    | { schema?: unknown; ref?: string; unresolved?: boolean }
    | null;
  if (!ref) return null;
  if (ref.unresolved) {
    return <p className="text-sm text-muted-foreground">{t("endpointsUnresolved")}</p>;
  }
  if (ref.ref) {
    return (
      <code className="rounded bg-muted px-1.5 py-0.5 text-sm">{ref.ref}</code>
    );
  }
  const pretty = prettySchema(ref.schema);
  if (!pretty) {
    return <p className="text-sm text-muted-foreground">—</p>;
  }
  return (
    <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
      {pretty}
    </pre>
  );
}
