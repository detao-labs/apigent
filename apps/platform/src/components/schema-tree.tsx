"use client";

import * as React from "react";
import { JsonSchemaViewer } from "cf-json-schema-viz";
import { useTheme } from "@/hooks/use-theme";

type ViewerSchema = React.ComponentProps<typeof JsonSchemaViewer>["schema"];

/**
 * OpenAPI 3.1 允许 type 为数组（如 ["string", "null"]），而 viewer 按
 * draft-04 的单一 type 渲染。这里递归归一化：类型数组取首个，null 标记为
 * nullable。$ref 已在导入期内联展开，这里不需要处理引用。
 */
function normalizeSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  const s = { ...(schema as Record<string, unknown>) };

  if (Array.isArray(s.type)) {
    const types = s.type.filter((t): t is string => typeof t === "string");
    s.type = types[0];
    if (types.includes("null") && !s.nullable) s.nullable = true;
  }
  if (s.items && typeof s.items === "object") {
    s.items = normalizeSchema(s.items);
  }
  if (s.properties && typeof s.properties === "object") {
    s.properties = Object.fromEntries(
      Object.entries(s.properties as Record<string, unknown>).map(
        ([key, value]) => [key, normalizeSchema(value)],
      ),
    );
  }
  if (s.additionalProperties && typeof s.additionalProperties === "object") {
    s.additionalProperties = normalizeSchema(s.additionalProperties);
  }
  for (const key of ["allOf", "oneOf", "anyOf"] as const) {
    if (Array.isArray(s[key])) {
      s[key] = (s[key] as unknown[]).map(normalizeSchema);
    }
  }
  return s;
}

/** JSON Schema 树展示，主题跟随平台明暗模式（cf-json-schema-viz）。 */
export function SchemaTree({ schema }: { schema: unknown }) {
  const { resolved } = useTheme();
  return (
    <JsonSchemaViewer
      schema={normalizeSchema(schema) as ViewerSchema}
      data-theme={resolved ? "dark" : "light"}
      defaultExpandedDepth={2}
      maxHeight={480}
    />
  );
}
