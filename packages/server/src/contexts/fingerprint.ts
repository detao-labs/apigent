// ═══════════════════════════════════════════════════════════════════
// Technical Fingerprint — 接口技术指纹与版本复用
// ═══════════════════════════════════════════════════════════════════
//
// 指纹输入（归一化后 JSON.stringify → SHA-256）：
//   operationId + method + path + summary + description
//   + parameters + requestSchema + responses（按 statusCode+contentType 排序）
//
// 匹配规则（docs/modules/business-context.md §2）：
//   key = operationId ?? `${method}:${path}`
//   key 相同且指纹相同 → 复用上一版上下文（快照复制）
//   key 相同但指纹不同 / key 不存在 → 重新生成
// ═══════════════════════════════════════════════════════════════════

import { createHash } from "node:crypto";
import { buildEndpointKey } from "../openapi/key";

export interface FingerprintResponse {
  statusCode: string;
  contentType: string | null;
  schema: unknown;
}

export interface FingerprintEndpoint {
  operationId: string | null;
  method: string;
  path: string;
  summary: string | null;
  description: string | null;
  parameters: unknown;
  requestSchema: unknown;
  responses: FingerprintResponse[];
}

/** 跨版本身份标识：operationId 优先，缺省用 method:path */
export function endpointKey(endpoint: {
  operationId: string | null;
  method: string;
  path: string;
}): string {
  return endpoint.operationId ?? buildEndpointKey(endpoint.method, endpoint.path);
}

/** 计算接口技术指纹（SHA-256 hex） */
export function computeEndpointFingerprint(endpoint: FingerprintEndpoint): string {
  const payload = {
    operationId: endpoint.operationId,
    method: endpoint.method,
    path: endpoint.path,
    summary: endpoint.summary,
    description: endpoint.description,
    parameters: endpoint.parameters,
    requestSchema: endpoint.requestSchema,
    responses: [...endpoint.responses]
      .sort((a, b) =>
        `${a.statusCode}:${a.contentType ?? ""}`.localeCompare(
          `${b.statusCode}:${b.contentType ?? ""}`,
        ),
      )
      .map((r) => ({ statusCode: r.statusCode, contentType: r.contentType, schema: r.schema })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
