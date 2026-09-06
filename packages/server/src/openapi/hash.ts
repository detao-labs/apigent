// ═══════════════════════════════════════════════════════════════════
// Content Hash — 内容寻址 hash（stableStringify + SHA-256）
// ═══════════════════════════════════════════════════════════════════

import { createHash } from "node:crypto";
import type { APIEntry, SchemaEntry, ComponentDef, ResponseDef } from "./types";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** 接口身份：operationId 优先，缺省 METHOD:PATH（大写+trim）。 */
export function endpointIdentity(operationId: string | null | undefined, method: string, path: string): string {
  return operationId ?? `${method.trim().toUpperCase()}:${path.trim()}`;
}

/** 单条 response 的 hash（含 statusCode/contentType/description/schema）。 */
export function hashResponse(resp: ResponseDef): string {
  const schema = (resp.schema && resp.schema.schema) || null;
  return sha256(
    stableStringify({
      statusCode: resp.statusCode,
      contentType: resp.contentType ?? null,
      description: resp.description,
      schema,
    }),
  );
}

/** 接口 content_hash：head + sorted responses[].hash 列表。 */
export function hashEndpoint(api: APIEntry): string {
  const responses = [...api.responses]
    .sort((a, b) =>
      `${a.statusCode}:${a.contentType ?? ""}`.localeCompare(`${b.statusCode}:${b.contentType ?? ""}`),
    )
    .map((r) => ({ hash: hashResponse(r), statusCode: r.statusCode, contentType: r.contentType ?? null }));

  return sha256(
    stableStringify({
      method: api.method,
      path: api.path,
      operationId: api.operationId ?? null,
      summary: api.summary ?? null,
      description: api.description ?? null,
      deprecated: api.deprecated,
      requestContentType: api.requestContentType ?? null,
      requestSchema: (api.requestBody && api.requestBody.schema) || null,
      parameters: (api.parameters ?? []).map((p) => ({
        name: p.name,
        in: p.in,
        required: p.required,
        description: p.description ?? null,
        schema: p.schema ?? null,
        example: p.example ?? null,
      })),
      tags: [...(api.tags ?? [])].sort(),
      security: api.security ?? [],
      responses,
    }),
  );
}

/** 数据模型 content_hash。 */
export function hashDataModel(schema: SchemaEntry): string {
  return sha256(
    stableStringify({
      name: schema.name,
      type: schema.type ?? null,
      schemaRaw: {
        type: schema.type ?? null,
        properties: schema.properties ?? {},
        required: schema.required ?? [],
      },
      description: schema.description ?? null,
    }),
  );
}

/** 组件 content_hash。 */
export function hashComponent(component: ComponentDef): string {
  return sha256(
    stableStringify({
      kind: component.kind,
      name: component.name,
      defType: component.defType ?? null,
      payload: component.payload ?? {},
      description: component.description ?? null,
    }),
  );
}
