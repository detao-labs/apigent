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
import { Boxes, Search, X } from "lucide-react";
import type { RepoDataModel } from "@/services/repos";

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
      const itemType = typeLabel(s.items);
      return `array<${itemType}>`;
    }
    return s.type;
  }
  return "—";
}

function descriptionOf(schema: unknown): string | null {
  if (!schema || typeof schema !== "object") return null;
  const s = schema as Record<string, unknown>;
  return typeof s.description === "string" ? s.description : null;
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
  const [selected, setSelected] = React.useState<RepoDataModel | null>(null);

  const filtered = models.filter((m) => {
    const q = query.trim().toLowerCase();
    return (
      !q ||
      m.name.toLowerCase().includes(q) ||
      (m.description ?? "").toLowerCase().includes(q)
    );
  });

  if (models.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Boxes className="mb-4 size-12 text-muted-foreground/50" />
          <h3 className="mb-1 text-lg font-semibold">{t("schemasEmpty")}</h3>
          <p className="max-w-md text-muted-foreground">{t("schemasEmptyDesc")}</p>
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
            placeholder={t("schemasSearchPlaceholder")}
            className="pl-8"
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {t("schemasCount", { count: filtered.length })}
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <p className="text-muted-foreground">{t("schemasNoResults")}</p>
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
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>{t("schemasName")}</TableHead>
                  <TableHead>{t("schemasType")}</TableHead>
                  <TableHead className="text-right">
                    {t("schemasFieldCount")}
                  </TableHead>
                  <TableHead className="hidden md:table-cell">
                    {t("schemasDescription")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((m) => {
                  const raw = (m.schemaRaw ?? {}) as RawSchema;
                  return (
                    <TableRow
                      key={m.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(m)}
                    >
                      <TableCell>
                        <span className="font-mono text-sm font-medium">
                          {m.name}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{m.schemaType ?? typeLabel(raw)}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {propertyCount(raw)}
                      </TableCell>
                      <TableCell className="hidden max-w-xs md:table-cell">
                        <span className="line-clamp-1 text-sm text-muted-foreground">
                          {m.description ?? "—"}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
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
          {selected && <DataModelDetail model={selected} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DataModelDetail({ model }: { model: RepoDataModel }) {
  const t = useTranslations("repos.detail");
  const raw = (model.schemaRaw ?? {}) as RawSchema;
  const properties = raw.properties ?? {};
  const required = new Set(raw.required ?? []);
  const entries = Object.entries(properties);

  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold">{model.name}</span>
          <Badge variant="secondary">{model.schemaType ?? typeLabel(raw)}</Badge>
        </div>
        <SheetTitle>{model.name}</SheetTitle>
        {model.description && (
          <SheetDescription>{model.description}</SheetDescription>
        )}
      </SheetHeader>

      <div className="space-y-5 px-4 pb-6">
        <div>
          <h4 className="mb-1.5 text-sm font-medium">
            {t("schemasProperties")}
            {entries.length > 0 && ` (${entries.length})`}
          </h4>
          {entries.length === 0 ? (
            <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
              {JSON.stringify(raw, null, 2)}
            </pre>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("schemasName")}</TableHead>
                    <TableHead>{t("schemasType")}</TableHead>
                    <TableHead>{t("schemasRequired")}</TableHead>
                    <TableHead>{t("schemasDescription")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map(([name, schema]) => (
                    <TableRow key={name}>
                      <TableCell className="font-mono text-sm">{name}</TableCell>
                      <TableCell className="font-mono text-sm">
                        {typeLabel(schema)}
                      </TableCell>
                      <TableCell>
                        {required.has(name) ? (
                          <Badge variant="destructive">
                            {t("schemasRequired")}
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {descriptionOf(schema) ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
