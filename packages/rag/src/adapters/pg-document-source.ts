// ═══════════════════════════════════════════════════════════════════
// RAG Adapter — pg-document-source（P4-1）
// ═══════════════════════════════════════════════════════════════════
//
// 「API 知识 → 待索引文档」的内置实现：从 `version_entity_links` 取某个 commit 用到的
// 内容块（endpoints / data_models / components），叠加该 commit 的 `business_contexts`，
// 渲染成 L0/L1/L2/L3 四个层级的 `RagDocument[]`。
//
// 三个刻意的设计点：
//
// 1. **版本收窄靠 link，不靠 `endpoints` 自己** —— endpoints 是版本无关的 blob
//    （P0-4），「这个 commit 有哪些接口」只能由 `version_entity_links` 回答。这里读
//    的是 commit，不是 version：活跃单位是 commit。
// 2. **`req.commitId` 缺省 = 主版本的 head**（`versions.is_default` 的 head_commit_id）。
//    该列在首个导入前可能为 NULL —— 此时返回空数组（= 该仓库还没有可索引的内容），
//    不是错误。
// 3. **只读、无副作用、不截断**：字段缺失就少渲染一段，内容存在就完整写入。控长度
//    是 chunker（P4-2）的职责。
//
// ⚠️ 给 P4-6（对账式同步）的明确约束：`IndexRequest.endpoints` 过滤**只作用于
// endpoint 级文档**（L2/L3）；project / tag 文档始终全量产出（它们不因过滤而变，
// content_hash 相同即被复用）。因此**部分重索引时，删除范围必须同样收窄到这些
// identity_key** —— 否则对账会把其余接口的 chunk 当成「不在期望集合里」删掉，
// 那是内容丢失，不是性能问题。
// ═══════════════════════════════════════════════════════════════════

import type { IndexRequest, RagDocument, RagDocumentSource, SqlExecutor } from "../contracts";
import { RagConfigError } from "../contracts";
import type { RagDocumentSourceFactory } from "../pipeline/types";
import {
  detectLang,
  renderEndpointText,
  renderProjectText,
  renderRequestSchemaText,
  renderResponseSchemaText,
  renderRulesText,
  renderTagText,
  type PgContextRow,
  type PgDefinitionRow,
  type PgEndpointRow,
  type PgResponseRow,
} from "./document-text";

interface PgRepositoryRow {
  name: string;
  description: string | null;
  organizationId: string;
  capabilityContext: unknown;
}

// ───────────────────────────────────────────────────────────────────
// SQL（列名一律 alias 成 camelCase，与行类型逐字对应）
// ───────────────────────────────────────────────────────────────────

const QUERIES = {
  repository: `
    select r.name,
           r.description,
           r.organization_id as "organizationId",
           r.capability_context as "capabilityContext"
    from repositories r
    where r.id = $1
  `,
  defaultCommit: `
    select v.head_commit_id as "commitId"
    from versions v
    where v.repository_id = $1 and v.is_default = true
    limit 1
  `,
  endpoints: `
    select e.id,
           e.identity_key as "identityKey",
           e.operation_id as "operationId",
           e.method,
           e.path,
           e.summary,
           e.description,
           e.request_content_type as "requestContentType",
           e.request_schema as "requestSchema",
           e.parameters,
           e.tags,
           e.deprecated
    from version_entity_links l
    join endpoints e on e.id = l.entity_id
    where l.commit_id = $1 and l.entity_type = 'endpoint'
    order by e.path, e.method, e.id
  `,
  responses: `
    select r.endpoint_id as "endpointId",
           r.status_code as "statusCode",
           r.description,
           r.content_type as "contentType",
           r.schema,
           r.is_error as "isError"
    from endpoint_responses r
    where r.endpoint_id = any($1::text[])
    order by r.endpoint_id, r.status_code, r.content_type
  `,
  // 业务上下文按 commit 取（`version_id` 就是 commit id）—— 不需要先知道 endpoint id，
  // 少一次串行往返。
  contexts: `
    select b.entity_id as "entityId",
           b.capability_name as "capabilityName",
           b.intent,
           b.constraints,
           b.side_effects as "sideEffects",
           b.usage_scenarios as "usageScenarios",
           b.confidence,
           b.edited_by_human as "editedByHuman"
    from business_contexts b
    where b.version_id = $1 and b.entity_type = 'endpoint'
  `,
  definitions: `
    select l.entity_type as "entityType",
           coalesce(dm.name, c.name) as "name",
           coalesce(dm.description, c.description) as "description",
           c.kind,
           coalesce(dm.schema_raw, c.payload) as "payload"
    from version_entity_links l
    left join data_models dm on l.entity_type = 'data_model' and dm.id = l.entity_id
    left join components c on l.entity_type = 'component' and c.id = l.entity_id
    where l.commit_id = $1 and l.entity_type in ('data_model', 'component')
    order by name
  `,
} as const;

// ───────────────────────────────────────────────────────────────────
// 适配器
// ───────────────────────────────────────────────────────────────────

export interface PgDocumentSourceOptions {
  sql: SqlExecutor;
}

export function pgDocumentSource(options: PgDocumentSourceOptions): RagDocumentSource {
  const { sql } = options;

  return {
    async load(req: IndexRequest, scope: { repositoryIds: string[] }): Promise<RagDocument[]> {
      // 与 fixtureDocumentSource 同语义：scope 里没有这个仓库就不产出任何文档。
      // 生产路径上调用方（P5-4 resolveSearchScope）已经保证过权限，这里是防线。
      if (!scope.repositoryIds.includes(req.repositoryId)) return [];

      const [repository] = await sql.query<PgRepositoryRow>(QUERIES.repository, [req.repositoryId]);
      if (!repository) return [];

      const commitId = req.commitId ?? (await resolveDefaultCommitId(sql, req.repositoryId));
      if (!commitId) return [];

      const [allEndpoints, contexts, definitions] = await Promise.all([
        sql.query<PgEndpointRow>(QUERIES.endpoints, [commitId]),
        sql.query<PgContextRow>(QUERIES.contexts, [commitId]),
        sql.query<PgDefinitionRow>(QUERIES.definitions, [commitId]),
      ]);

      // 部分重索引：只收窄 endpoint 级文档（见文件头给 P4-6 的约束）。
      const wanted = req.endpoints ? new Set(req.endpoints) : undefined;
      const endpoints = wanted
        ? allEndpoints.filter((endpoint) => wanted.has(endpoint.identityKey))
        : allEndpoints;

      const responseRows =
        endpoints.length > 0
          ? await sql.query<PgResponseRow>(QUERIES.responses, [
              endpoints.map((endpoint) => endpoint.id),
            ])
          : [];

      return assembleDocuments({
        repository,
        commitId,
        endpoints,
        allEndpoints,
        responses: responseRows,
        contexts,
        definitions,
      });
    },
  };
}

/**
 * `RagDocumentSourceFactory` 形态的包装：注册表（P6-1）按名字注册它即可。
 *
 * 直接从 `deps.sql` 取句柄并要求它符合 `SqlExecutor` —— 取不到时抛可读错误，
 * 而不是等到第一次查询才报 `undefined is not a function`。
 */
export const pgDocumentSourceProvider: RagDocumentSourceFactory = (ctx) =>
  pgDocumentSource({ sql: requireSqlExecutor(ctx.deps.sql) });

function requireSqlExecutor(candidate: unknown): SqlExecutor {
  if (
    candidate !== null &&
    typeof candidate === "object" &&
    typeof (candidate as SqlExecutor).query === "function"
  ) {
    return candidate as SqlExecutor;
  }
  throw new RagConfigError(
    'rag: provider "pg-document-source" needs a SqlExecutor in deps.sql ' +
      "(an object with a query(sql, params) method). The host injects it at registration time; " +
      "see docs/modules/rag-package.md §2.3.",
  );
}

async function resolveDefaultCommitId(
  sql: SqlExecutor,
  repositoryId: string,
): Promise<string | null> {
  const [row] = await sql.query<{ commitId: string | null }>(QUERIES.defaultCommit, [repositoryId]);
  return row?.commitId ?? null;
}

// ───────────────────────────────────────────────────────────────────
// 组装
// ───────────────────────────────────────────────────────────────────

interface AssembleInput {
  repository: PgRepositoryRow;
  commitId: string;
  endpoints: PgEndpointRow[];
  allEndpoints: PgEndpointRow[];
  responses: PgResponseRow[];
  contexts: PgContextRow[];
  definitions: PgDefinitionRow[];
}

/**
 * 组装顺序是**确定的**（project → tag 按字典序 → 接口按 path/method，每个接口
 * L2 → request → response → rules）：文档顺序影响 chunk_key 集合的可复现性，
 * 也影响单测能不能逐字断言。
 */
function assembleDocuments(input: AssembleInput): RagDocument[] {
  const { repository } = input;
  const organizationId = repository.organizationId;

  const contextsByEndpoint = new Map(input.contexts.map((row) => [row.entityId, row]));
  const responsesByEndpoint = new Map<string, PgResponseRow[]>();
  for (const row of input.responses) {
    const bucket = responsesByEndpoint.get(row.endpointId);
    if (bucket) bucket.push(row);
    else responsesByEndpoint.set(row.endpointId, [row]);
  }

  const definitionsByName = new Map(
    input.definitions
      .filter((row) => row.entityType === "data_model")
      .map((row) => [row.name, row]),
  );
  const securitySchemes = input.definitions.filter(
    (row) => row.entityType === "component" && row.kind === "securityScheme",
  );

  const documents: RagDocument[] = [];

  // L0 —— 仓库级全局约定（认证方式来自 components/securityScheme）
  const projectId = "project:overview";
  const projectText = renderProjectText({
    repositoryName: repository.name,
    repositoryDescription: repository.description,
    capabilityContext: repository.capabilityContext,
    securitySchemes,
  });
  documents.push({
    id: projectId,
    level: "project",
    lang: detectLang(projectText),
    organizationId,
    text: projectText,
    metadata: { commitId: input.commitId },
  });

  // L1 —— tag 概述。用**全量**接口分组（不受部分重索引过滤影响，见文件头）。
  for (const [tag, members] of groupByTag(input.allEndpoints)) {
    const text = renderTagText({ tag, endpoints: members });
    documents.push({
      id: `tag:${tag}`,
      level: "tag",
      lang: detectLang(text),
      organizationId,
      parentId: projectId,
      text,
      metadata: { commitId: input.commitId, tag, endpointCount: members.length },
    });
  }

  // L2 / L3 —— 逐接口
  for (const endpoint of input.endpoints) {
    const responses = responsesByEndpoint.get(endpoint.id) ?? [];
    const context = contextsByEndpoint.get(endpoint.id);
    const endpointId = `endpoint:${endpoint.method}:${endpoint.path}`;
    const primaryTag = endpoint.tags?.[0];
    // 与 groupByTag 的分组口径一致：没有 tag 的接口挂在 `tag:untagged` 下，
    // 否则它会成为唯一一个没有 parent 的 L2 文档（上下文扩展也就断了）。
    const parentTag = primaryTag ?? "untagged";

    const endpointText = renderEndpointText({ endpoint, responses, context });
    documents.push({
      id: endpointId,
      level: "endpoint",
      lang: detectLang(endpointText),
      organizationId,
      parentId: `tag:${parentTag}`,
      text: endpointText,
      fields: {
        method: endpoint.method,
        path: endpoint.path,
        ...(endpoint.summary ? { summary: endpoint.summary } : {}),
        ...(endpoint.tags ? { tags: endpoint.tags } : {}),
      },
      metadata: {
        commitId: input.commitId,
        identityKey: endpoint.identityKey,
        ...(endpoint.operationId ? { operationId: endpoint.operationId } : {}),
        ...(primaryTag ? { tag: primaryTag } : {}),
        ...(endpoint.deprecated ? { deprecated: true } : {}),
        ...(context ? { hasBusinessContext: true } : {}),
      },
    });

    if (hasRequestContent(endpoint)) {
      const requestText = renderRequestSchemaText({ endpoint, definitions: definitionsByName });
      documents.push({
        id: `schema:${endpoint.method}:${endpoint.path}:request`,
        level: "schema",
        lang: detectLang(requestText),
        organizationId,
        parentId: endpointId,
        text: requestText,
        metadata: { commitId: input.commitId, direction: "request" },
      });
    }

    if (responses.length > 0) {
      const responseText = renderResponseSchemaText({
        endpoint,
        responses,
        definitions: definitionsByName,
      });
      documents.push({
        id: `schema:${endpoint.method}:${endpoint.path}:response`,
        level: "schema",
        lang: detectLang(responseText),
        organizationId,
        parentId: endpointId,
        text: responseText,
        metadata: { commitId: input.commitId, direction: "response" },
      });
    }

    // L3c —— 业务规则：**只有存在业务上下文时才产出**（这是「有 / 无业务上下文」
    // 两条路径的分界点，也是 P4-1 验收的核心）。
    if (context) {
      const rulesText = renderRulesText(context);
      documents.push({
        id: `rules:${endpoint.method}:${endpoint.path}`,
        level: "rules",
        lang: detectLang(rulesText),
        organizationId,
        parentId: endpointId,
        text: rulesText,
        metadata: {
          commitId: input.commitId,
          ...(context.capabilityName ? { capabilityName: context.capabilityName } : {}),
          ...(context.confidence !== null ? { confidence: context.confidence } : {}),
          ...(context.editedByHuman ? { editedByHuman: true } : {}),
        },
      });
    }
  }

  return documents;
}

/** 只带参数的接口也要有 request 文档 —— 参数本身就是「怎么调」的关键信息。 */
function hasRequestContent(endpoint: PgEndpointRow): boolean {
  if (endpoint.requestSchema !== null && endpoint.requestSchema !== undefined) return true;
  return Array.isArray(endpoint.parameters) && endpoint.parameters.length > 0;
}

/** 按 tag 分组；无 tag 的接口归入 `untagged`（不丢内容，也不造空 tag 文档）。 */
function groupByTag(endpoints: PgEndpointRow[]): Array<[string, PgEndpointRow[]]> {
  const groups = new Map<string, PgEndpointRow[]>();
  for (const endpoint of endpoints) {
    const tags = endpoint.tags && endpoint.tags.length > 0 ? endpoint.tags : ["untagged"];
    for (const tag of tags) {
      const bucket = groups.get(tag);
      if (bucket) bucket.push(endpoint);
      else groups.set(tag, [endpoint]);
    }
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}
