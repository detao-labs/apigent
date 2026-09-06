// ═══════════════════════════════════════════════════════════════════
// Diff Engine — 纯规则版本对比（不依赖 LLM）
// ═══════════════════════════════════════════════════════════════════
//
// 输入两个版本的「快照」（endpoints / schemas / components），结构化对比，
// 输出变更列表 + 摘要，并按如下规则判定影响：
//   - 删除 endpoint / schema / component → 破坏性（break）
//   - 新增 endpoint / schema / component → 兼容（新增）
//   - 修改 endpoint：
//       · 新增必填参数 / 请求体由可选变必填 → break
//       · 其余（summary / description / 新增可选参数）→ 非破坏
//   - 修改 schema：
//       · 新增必填字段（无 default）/ 删除字段 / 字段类型变化 → break
//       · 新增可选字段 / 扩展枚举 → 非破坏
//   - 修改 component：payload 变化 → 非破坏（保守；V1 再细化引用检查）
// 规则为 V0 初版，后续可扩展（枚举值 / ref 引用计数 / 字段 default 判断等）。
// ═══════════════════════════════════════════════════════════════════

import { buildEndpointKey } from "../openapi/key";

export interface EndpointDiffNode {
  method: string;
  path: string;
  operationId?: string | null;
  summary?: string | null;
  description?: string | null;
  deprecated?: boolean;
  parameters: {
    name: string;
    in: string;
    required: boolean;
    schema?: Record<string, unknown> | null;
  }[];
  requestContentType?: string | null;
  hasRequestBody: boolean;
}

export interface SchemaDiffNode {
  name: string;
  type?: string | null;
  schemaRaw: {
    type?: string | null;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface ComponentDiffNode {
  kind: string;
  name: string;
  defType?: string | null;
  payload: Record<string, unknown>;
}

export interface VersionSnapshot {
  endpoints: EndpointDiffNode[];
  schemas: SchemaDiffNode[];
  components: ComponentDiffNode[];
}

export type DiffCategory = "endpoint" | "schema" | "component";
export type DiffChangeType = "added" | "removed" | "modified";

/** 单个变更。subject 为展示主体（path / schema 名 / component 名）。 */
export interface DiffChange {
  id: string;
  category: DiffCategory;
  changeType: DiffChangeType;
  /** endpoint → `${method}:${path}`；schema → name；component → `${kind}::${name}` */
  key: string;
  /** 展示主文本 */
  subject: string;
  method?: string;
  path?: string;
  name?: string;
  kind?: string;
  /** 本 change 代表发生变化的字段名（供前端渲染「变更字段」） */
  fieldsChanged: string[];
  breaking: boolean;
}

export interface DiffResult {
  fromVersionId: string;
  toVersionId: string;
  added: number;
  removed: number;
  modified: number;
  breaking: number;
  changes: DiffChange[];
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function endpointKey(e: EndpointDiffNode): string {
  return buildEndpointKey(e.method, e.path);
}

function paramEssential(p: { name: string; in: string; required: boolean }): string {
  return `${p.in}:${p.name}`;
}

/** 单版本内 endpoint 去重（同一 method+path 只保留一条），用于稳定对比。 */
function uniqueBy<T>(items: T[], key: (item: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) if (!map.has(key(item))) map.set(key(item), item);
  return map;
}

/**
 * 对比两个版本的端点，返回变更数组。
 */
function diffEndpoints(
  from: Map<string, EndpointDiffNode>,
  to: Map<string, EndpointDiffNode>,
): DiffChange[] {
  const changes: DiffChange[] = [];
  const allKeys = new Set([...from.keys(), ...to.keys()]);
  for (const key of allKeys) {
    const a = from.get(key);
    const b = to.get(key);
    if (a && !b) {
      changes.push({
        id: `ep-removed-${key}`,
        category: "endpoint",
        changeType: "removed",
        key,
        subject: a.path,
        method: a.method,
        path: a.path,
        fieldsChanged: [],
        breaking: true,
      });
      continue;
    }
    if (!a && b) {
      changes.push({
        id: `ep-added-${key}`,
        category: "endpoint",
        changeType: "added",
        key,
        subject: b.path,
        method: b.method,
        path: b.path,
        fieldsChanged: [],
        breaking: false,
      });
      continue;
    }
    if (!a || !b) continue;

    const fieldsChanged: string[] = [];
    if ((a.summary ?? null) !== (b.summary ?? null)) fieldsChanged.push("summary");
    if ((a.description ?? null) !== (b.description ?? null)) fieldsChanged.push("description");
    if (!!a.deprecated !== !!b.deprecated) fieldsChanged.push("deprecated");
    if ((a.requestContentType ?? null) !== (b.requestContentType ?? null)) {
      fieldsChanged.push("requestContentType");
    }

    const aParams = uniqueBy(a.parameters, paramEssential);
    const bParams = uniqueBy(b.parameters, paramEssential);
    let breaking = false;
    for (const [pk, bp] of bParams) {
      const ap = aParams.get(pk);
      if (!ap) {
        fieldsChanged.push(`param:${bp.name}`);
        if (bp.required) breaking = true;
      }
      if (ap && !ap.required && bp.required) {
        fieldsChanged.push(`param:${bp.name}:required`);
        breaking = true;
      }
    }
    for (const [pk, ap] of aParams) {
      if (!bParams.has(pk)) {
        fieldsChanged.push(`param:${ap.name}:removed`);
        if (ap.required) breaking = true;
      }
    }
    // 请求体：由「无请求体」变「有请求体」不视为破坏；仅当 schema 必填化时后续细化。
    if (!a.hasRequestBody && b.hasRequestBody) fieldsChanged.push("requestBody");

    if (fieldsChanged.length > 0) {
      changes.push({
        id: `ep-modified-${key}`,
        category: "endpoint",
        changeType: "modified",
        key,
        subject: b.path,
        method: b.method,
        path: b.path,
        fieldsChanged,
        breaking,
      });
    }
  }
  return changes;
}

function diffSchemas(
  from: Map<string, SchemaDiffNode>,
  to: Map<string, SchemaDiffNode>,
): DiffChange[] {
  const changes: DiffChange[] = [];
  const allKeys = new Set([...from.keys(), ...to.keys()]);
  for (const name of allKeys) {
    const a = from.get(name);
    const b = to.get(name);
    if (a && !b) {
      changes.push({
        id: `schema-removed-${name}`,
        category: "schema",
        changeType: "removed",
        key: name,
        subject: name,
        name,
        fieldsChanged: [],
        breaking: true,
      });
      continue;
    }
    if (!a && b) {
      changes.push({
        id: `schema-added-${name}`,
        category: "schema",
        changeType: "added",
        key: name,
        subject: name,
        name,
        fieldsChanged: [],
        breaking: false,
      });
      continue;
    }
    if (!a || !b) continue;

    const aProps = (a.schemaRaw.properties ?? {}) as Record<string, unknown>;
    const bProps = (b.schemaRaw.properties ?? {}) as Record<string, unknown>;
    const aRequired = new Set(a.schemaRaw.required ?? []);
    const bRequired = new Set(b.schemaRaw.required ?? []);
    const allProps = new Set([...Object.keys(aProps), ...Object.keys(bProps)]);
    const fieldsChanged: string[] = [];
    let breaking = false;

    for (const key of allProps) {
      const hasA = Object.prototype.hasOwnProperty.call(aProps, key);
      const hasB = Object.prototype.hasOwnProperty.call(bProps, key);
      if (!hasA && hasB) {
        fieldsChanged.push(`prop:${key}`);
        // 新增必填字段且无 default → 破坏
        if (bRequired.has(key) && !hasDefault(bProps[key])) breaking = true;
      } else if (hasA && !hasB) {
        fieldsChanged.push(`prop:${key}:removed`);
        breaking = true;
      } else if (hasA && hasB) {
        const typeChanged = stableStringify(aProps[key]) !== stableStringify(bProps[key]);
        if (typeChanged) {
          fieldsChanged.push(`prop:${key}:type`);
          breaking = true;
        }
      }
    }
    for (const key of bRequired) {
      if (!aRequired.has(key) && !Object.prototype.hasOwnProperty.call(bProps, key)) {
        fieldsChanged.push(`required:${key}`);
        breaking = true;
      }
    }
    if (aRequired.size !== bRequired.size) {
      for (const key of bRequired) {
        if (!aRequired.has(key) && Object.prototype.hasOwnProperty.call(bProps, key)) {
          fieldsChanged.push(`required:${key}`);
          if (!hasDefault(bProps[key])) breaking = true;
        }
      }
      for (const key of aRequired) {
        if (!bRequired.has(key)) fieldsChanged.push(`required:${key}:removed`);
      }
    }

    if (fieldsChanged.length > 0) {
      changes.push({
        id: `schema-modified-${name}`,
        category: "schema",
        changeType: "modified",
        key: name,
        subject: name,
        name,
        fieldsChanged,
        breaking,
      });
    }
  }
  return changes;
}

function hasDefault(value: unknown): boolean {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    return Object.prototype.hasOwnProperty.call(obj, "default");
  }
  return false;
}

function diffComponents(
  from: Map<string, ComponentDiffNode>,
  to: Map<string, ComponentDiffNode>,
): DiffChange[] {
  const changes: DiffChange[] = [];
  const allKeys = new Set([...from.keys(), ...to.keys()]);
  for (const key of allKeys) {
    const a = from.get(key);
    const b = to.get(key);
    if (a && !b) {
      changes.push({
        id: `component-removed-${key}`,
        category: "component",
        changeType: "removed",
        key,
        subject: a.name,
        name: a.name,
        kind: a.kind,
        fieldsChanged: [],
        breaking: true,
      });
      continue;
    }
    if (!a && b) {
      changes.push({
        id: `component-added-${key}`,
        category: "component",
        changeType: "added",
        key,
        subject: b.name,
        name: b.name,
        kind: b.kind,
        fieldsChanged: [],
        breaking: false,
      });
      continue;
    }
    if (!a || !b) continue;
    if (stableStringify(a.payload) !== stableStringify(b.payload)) {
      changes.push({
        id: `component-modified-${key}`,
        category: "component",
        changeType: "modified",
        key,
        subject: b.name,
        name: b.name,
        kind: b.kind,
        fieldsChanged: ["payload"],
        breaking: false,
      });
    }
  }
  return changes;
}

/**
 * 对比两个版本快照（from → to）。
 */
export function diffVersionSnapshots(
  fromSnapshot: VersionSnapshot,
  toSnapshot: VersionSnapshot,
  fromVersionId: string,
  toVersionId: string,
): DiffResult {
  const fromEndpoints = uniqueBy(fromSnapshot.endpoints, endpointKey);
  const toEndpoints = uniqueBy(toSnapshot.endpoints, endpointKey);
  const fromSchemas = uniqueBy(fromSnapshot.schemas, (s) => s.name);
  const toSchemas = uniqueBy(toSnapshot.schemas, (s) => s.name);
  const fromComponents = uniqueBy(fromSnapshot.components, (c) => `${c.kind}::${c.name}`);
  const toComponents = uniqueBy(toSnapshot.components, (c) => `${c.kind}::${c.name}`);

  const changes = [
    ...diffEndpoints(fromEndpoints, toEndpoints),
    ...diffSchemas(fromSchemas, toSchemas),
    ...diffComponents(fromComponents, toComponents),
  ];

  const added = changes.filter((c) => c.changeType === "added").length;
  const removed = changes.filter((c) => c.changeType === "removed").length;
  const modified = changes.filter((c) => c.changeType === "modified").length;
  const breaking = changes.filter((c) => c.breaking).length;

  return {
    fromVersionId,
    toVersionId,
    added,
    removed,
    modified,
    breaking,
    changes,
  };
}
