// ═══════════════════════════════════════════════════════════════════
// RAG Adapters — 「API 知识 → 可检索文本」的渲染规则
// ═══════════════════════════════════════════════════════════════════
//
// 这是整个 RAG 里最影响检索质量、也最需要能被 A/B 的一段：同样的数据，拼成什么
// 文本直接决定 embedding 与 BM25 能召回什么。所以它被抽成纯函数（无 IO、无状态），
// 单测可以直接对同一份数据断言「拼出来是什么」。
//
// 三条渲染原则：
//
// 1. **不截断**。字段缺失就整段不输出，但存在的内容一律完整写入 —— 静默截断是
//    最难发现的检索退化（内容在库里、检索永远召不回）。要控长度是 chunker（P4-2）
//    的事，它有 parent 与 level 可以安全地切。
// 2. **标签用英文、内容保留原语言**。`Summary:` / `Parameters:` 这类是脚手架，
//    不是知识本身；内容（中文 spec、英文 spec、LLM 生成的业务上下文）原样保留。
//    真正的中英双 chunk（翻译）是 P4-2 的决策，这里只如实标注 lang。
// 3. **对 jsonb 一律防御性读取**。`parameters` / `schema` / `constraints` 都是
//    解析出来的 OpenAPI 片段，形状由外部输入决定，读不到就跳过而不是抛错。
// ═══════════════════════════════════════════════════════════════════

import type { ChunkLang } from "../contracts";

// ───────────────────────────────────────────────────────────────────
// 输入行（与 SQL 里的别名一致）
// ───────────────────────────────────────────────────────────────────

export interface PgEndpointRow {
  id: string;
  identityKey: string;
  operationId: string | null;
  method: string;
  path: string;
  summary: string | null;
  description: string | null;
  requestContentType: string | null;
  requestSchema: unknown;
  parameters: unknown;
  tags: string[] | null;
  deprecated: boolean | null;
}

export interface PgResponseRow {
  endpointId: string;
  statusCode: string;
  description: string | null;
  contentType: string | null;
  schema: unknown;
  isError: boolean | null;
}

export interface PgContextRow {
  entityId: string;
  capabilityName: string | null;
  intent: string | null;
  constraints: unknown;
  sideEffects: string[] | null;
  usageScenarios: unknown;
  confidence: number | null;
  editedByHuman: boolean | null;
}

/** 版本无关的可复用定义：`data_model`（components/schemas）或 `component`（其余）。 */
export interface PgDefinitionRow {
  entityType: "data_model" | "component";
  name: string;
  description: string | null;
  /** components.kind（response / securityScheme / parameter …） */
  kind: string | null;
  payload: unknown;
}

// ───────────────────────────────────────────────────────────────────
// 语言判定
// ───────────────────────────────────────────────────────────────────

const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/**
 * 按内容判定语言 —— 出现 CJK 就是 `zh`，否则 `en`。
 *
 * 为什么是判定而不是配置：一个仓库里中英混排是常态（spec 英文、业务上下文中文），
 * 逐文档判定比逐仓库配置更贴近事实。判定结果只影响「标成哪种语言」，不影响内容。
 */
export function detectLang(text: string): ChunkLang {
  return CJK_PATTERN.test(text) ? "zh" : "en";
}

// ───────────────────────────────────────────────────────────────────
// 渲染
// ───────────────────────────────────────────────────────────────────

interface Block {
  heading: string;
  lines: string[];
}

/** 按「标题 + 内容」拼块，空块直接丢掉 —— 输出的形状对同一份输入始终一致。 */
function renderBlocks(title: string, blocks: Block[]): string {
  const parts: string[] = [title];
  for (const block of blocks) {
    if (block.lines.length === 0) continue;
    parts.push(`${block.heading}:`);
    parts.push(...block.lines);
  }
  return parts.join("\n");
}

/** L2 —— endpoint 全文（检索主单元）。 */
export function renderEndpointText(input: {
  endpoint: PgEndpointRow;
  responses: PgResponseRow[];
  context?: PgContextRow;
}): string {
  const { endpoint, responses, context } = input;
  const blocks: Block[] = [];

  const head = `${endpoint.method} ${endpoint.path}`;
  if (endpoint.summary) blocks.push({ heading: "Summary", lines: [endpoint.summary] });
  if (endpoint.description) blocks.push({ heading: "Description", lines: [endpoint.description] });
  if (endpoint.deprecated) blocks.push({ heading: "Deprecated", lines: ["yes"] });
  if (endpoint.tags && endpoint.tags.length > 0) {
    blocks.push({ heading: "Tags", lines: [endpoint.tags.join(", ")] });
  }

  const parameters = renderParameters(endpoint.parameters);
  if (parameters.length > 0) blocks.push({ heading: "Parameters", lines: parameters });

  const responseLines = responses.map(formatResponseSummary);
  if (responseLines.length > 0) blocks.push({ heading: "Responses", lines: responseLines });

  if (context) {
    if (context.capabilityName) {
      blocks.push({ heading: "Capability", lines: [context.capabilityName] });
    }
    if (context.intent) blocks.push({ heading: "Intent", lines: [context.intent] });
    const reasons = renderBullets(context.usageScenarios);
    if (reasons.length > 0) blocks.push({ heading: "Usage scenarios", lines: reasons });
  }

  return renderBlocks(head, blocks);
}

/** L1 —— tag 概述：这个 tag 下有哪些接口、各自做什么。 */
export function renderTagText(input: { tag: string; endpoints: PgEndpointRow[] }): string {
  const lines = input.endpoints.map((endpoint) => {
    const summary = endpoint.summary ? ` — ${endpoint.summary}` : "";
    return `- ${endpoint.method} ${endpoint.path}${summary}`;
  });

  return renderBlocks(`Tag: ${input.tag}`, [{ heading: "Endpoints", lines }]);
}

/** L0 —— 仓库级全局约定：仓库自述 + 认证方式。 */
export function renderProjectText(input: {
  repositoryName: string;
  repositoryDescription: string | null;
  capabilityContext: unknown;
  securitySchemes: PgDefinitionRow[];
}): string {
  const blocks: Block[] = [];
  if (input.repositoryDescription) {
    blocks.push({ heading: "Description", lines: [input.repositoryDescription] });
  }

  const capabilityLines = renderKeyValues(input.capabilityContext);
  if (capabilityLines.length > 0) {
    blocks.push({ heading: "Capability context", lines: capabilityLines });
  }

  const securityLines = input.securitySchemes.map(formatSecurityScheme);
  if (securityLines.length > 0) blocks.push({ heading: "Authentication", lines: securityLines });

  return renderBlocks(`Repository: ${input.repositoryName}`, blocks);
}

/** L3a —— 请求侧 schema（参数 + requestBody + 被引用的模型定义）。 */
export function renderRequestSchemaText(input: {
  endpoint: PgEndpointRow;
  definitions: Map<string, PgDefinitionRow>;
}): string {
  const { endpoint, definitions } = input;
  const blocks: Block[] = [];

  const parameters = renderParameters(endpoint.parameters);
  if (parameters.length > 0) blocks.push({ heading: "Parameters", lines: parameters });

  if (endpoint.requestContentType) {
    blocks.push({ heading: "Content-Type", lines: [endpoint.requestContentType] });
  }
  if (endpoint.requestSchema !== null && endpoint.requestSchema !== undefined) {
    blocks.push({
      heading: "Body schema",
      lines: [
        renderJson(endpoint.requestSchema),
        ...renderReferencedDefinitions(endpoint.requestSchema, definitions),
      ],
    });
  }

  return renderBlocks(`Request schema: ${endpoint.method} ${endpoint.path}`, blocks);
}

/** L3b —— 响应侧 schema（每个状态码 + 被引用的模型定义）。 */
export function renderResponseSchemaText(input: {
  endpoint: PgEndpointRow;
  responses: PgResponseRow[];
  definitions: Map<string, PgDefinitionRow>;
}): string {
  const { endpoint, responses, definitions } = input;
  const lines: string[] = [];

  for (const response of responses) {
    lines.push(formatResponseSummary(response));
    if (response.schema !== null && response.schema !== undefined) {
      lines.push(`  schema: ${renderJson(response.schema)}`);
      for (const definition of renderReferencedDefinitions(response.schema, definitions)) {
        lines.push(`  ${definition}`);
      }
    }
  }

  return renderBlocks(`Response schema: ${endpoint.method} ${endpoint.path}`, [
    { heading: "Responses", lines },
  ]);
}

/** L3c —— 业务规则：约束 / 副作用 / 使用场景（只有存在业务上下文时才产出）。 */
export function renderRulesText(context: PgContextRow): string {
  const blocks: Block[] = [];
  const constraints = renderBullets(context.constraints);
  if (constraints.length > 0) blocks.push({ heading: "Constraints", lines: constraints });
  if (context.sideEffects && context.sideEffects.length > 0) {
    blocks.push({ heading: "Side effects", lines: context.sideEffects.map((item) => `- ${item}`) });
  }
  const scenarios = renderBullets(context.usageScenarios);
  if (scenarios.length > 0) blocks.push({ heading: "Usage scenarios", lines: scenarios });

  return renderBlocks("Business rules", blocks);
}

// ───────────────────────────────────────────────────────────────────
// 内部渲染
// ───────────────────────────────────────────────────────────────────

function renderParameters(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const name = asString(item.name);
    if (!name) return [];
    const where = asString(item.in);
    const required = item.required === true ? ", required" : "";
    const type = isRecord(item.schema) ? asString(item.schema.type) : undefined;
    const parts = [where, `${type ?? "unknown"}${required}`].filter(Boolean).join(", ");
    const description = asString(item.description);
    return [`- ${name} (${parts})${description ? `: ${description}` : ""}`];
  });
}

function formatResponseSummary(response: PgResponseRow): string {
  const contentType = response.contentType ? ` (${response.contentType})` : "";
  const error = response.isError ? " [error]" : "";
  const description = response.description ? `: ${response.description}` : "";
  return `- ${response.statusCode}${contentType}${error}${description}`;
}

function formatSecurityScheme(definition: PgDefinitionRow): string {
  const payload = isRecord(definition.payload) ? definition.payload : {};
  const type = asString(payload.type) ?? definition.kind ?? "unknown";
  const location = [asString(payload.in), asString(payload.scheme), asString(payload.bearerFormat)]
    .filter(Boolean)
    .join(", ");
  const description = definition.description ? `: ${definition.description}` : "";
  return `- ${definition.name} (${[type, location].filter(Boolean).join(", ")})${description}`;
}

/** jsonb 是自由形状 —— 字符串数组、对象数组、单对象都尽力渲染，实在不认识就 JSON。 */
function renderBullets(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") return [`- ${value}`];
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === "string") return [`- ${item}`];
      if (isRecord(item)) return [`- ${renderRecordInline(item)}`];
      return [`- ${renderJson(item)}`];
    });
  }
  if (isRecord(value)) return renderKeyValues(value);
  return [`- ${renderJson(value)}`];
}

function renderKeyValues(value: unknown): string[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, item]) => {
    if (item === null || item === undefined || item === "") return [];
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      return [`- ${key}: ${String(item)}`];
    }
    if (Array.isArray(item) && item.every((entry) => typeof entry === "string")) {
      return [`- ${key}: ${item.join(", ")}`];
    }
    return [`- ${key}: ${renderJson(item)}`];
  });
}

function renderRecordInline(record: Record<string, unknown>): string {
  const parts = Object.entries(record).flatMap(([key, value]) => {
    if (value === null || value === undefined || value === "") return [];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return [`${key}=${String(value)}`];
    }
    return [`${key}=${renderJson(value)}`];
  });
  return parts.join(" ");
}

/**
 * 把 schema 里 `$ref` 指向的模型定义一并写进文本。
 *
 * 为什么必须内联：检索单元是**单个 chunk**，而 `{"$ref":"#/components/schemas/Order"}`
 * 本身**不含** Order 的字段信息 —— 不展开的话，「订单金额字段叫什么」这类查询永远
 * 召不回。展开的粒度是「引用到的模型」，不做递归展开定义里的引用（那会把整棵 schema
 * 树塞进一个 chunk，属于 P4-2 控长度时要处理的形态）。
 */
export function renderReferencedDefinitions(
  value: unknown,
  definitions: Map<string, PgDefinitionRow>,
): string[] {
  const lines: string[] = [];
  for (const name of collectSchemaRefs(value)) {
    const definition = definitions.get(name);
    if (!definition) continue;
    const description = definition.description ? ` — ${definition.description}` : "";
    lines.push(`  ${name}${description}: ${renderJson(definition.payload)}`);
  }
  return lines;
}

const REF_PATTERN = /^#\/components\/schemas\/(.+)$/;

/** 收集 schema 里出现的 `#/components/schemas/<Name>` 引用名（去重、保序）。 */
export function collectSchemaRefs(value: unknown): string[] {
  const found = new Set<string>();

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!isRecord(node)) return;
    for (const [key, item] of Object.entries(node)) {
      if (key === "$ref" && typeof item === "string") {
        const match = REF_PATTERN.exec(item);
        if (match?.[1]) found.add(match[1]);
        continue;
      }
      walk(item);
    }
  };

  walk(value);
  return [...found];
}

function renderJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    // 循环引用在 jsonb 里不可能出现（PG 不允许），但防御性兜一层。
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
