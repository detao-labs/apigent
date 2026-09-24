import { describe, it, expect } from "vitest";
import { RagConfigError, type SqlExecutor } from "../contracts";
import { pgDocumentSource, pgDocumentSourceProvider } from "./pg-document-source";
import type { PgContextRow, PgDefinitionRow, PgEndpointRow, PgResponseRow } from "./document-text";

// ───────────────────────────────────────────────────────────────────
// 假 SQL 执行器：按 SQL 文本特征分发固定行，并把调用记下来
// ───────────────────────────────────────────────────────────────────

interface FakeRows {
  repository?: unknown[];
  defaultCommit?: unknown[];
  endpoints?: unknown[];
  responses?: unknown[];
  contexts?: unknown[];
  definitions?: unknown[];
}

function fakeSql(rows: FakeRows) {
  const calls: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];

  const sql: SqlExecutor = {
    async query<Row>(text: string, params?: readonly unknown[]): Promise<Row[]> {
      calls.push({ sql: text, params });
      const key = pickQueryKey(text);
      return (rows[key] ?? []) as Row[];
    },
  };

  return {
    sql,
    calls,
    called: (key: keyof FakeRows) => calls.some((c) => pickQueryKey(c.sql) === key),
  };
}

function pickQueryKey(text: string): keyof FakeRows {
  if (text.includes("from repositories")) return "repository";
  if (text.includes("from versions")) return "defaultCommit";
  if (text.includes("join endpoints")) return "endpoints";
  if (text.includes("from endpoint_responses")) return "responses";
  if (text.includes("from business_contexts")) return "contexts";
  if (text.includes("from version_entity_links")) return "definitions";
  throw new Error(`unexpected query: ${text.slice(0, 40)}`);
}

// ───────────────────────────────────────────────────────────────────
// 样本
// ───────────────────────────────────────────────────────────────────

const REPO = {
  name: "订单服务",
  description: "订单与支付相关接口",
  organizationId: "org-1",
  capabilityContext: { domain: "电商", owner: "trade-team" },
};

function endpoint(overrides: Partial<PgEndpointRow> = {}): PgEndpointRow {
  return {
    id: "ep-refund",
    identityKey: "refundOrder",
    operationId: "refundOrder",
    method: "POST",
    path: "/orders/{id}/refund",
    summary: "发起退款",
    description: "对已支付订单发起退款。",
    requestContentType: "application/json",
    requestSchema: { $ref: "#/components/schemas/RefundRequest" },
    parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
    tags: ["订单"],
    deprecated: false,
    ...overrides,
  };
}

const RESPONSES: PgResponseRow[] = [
  {
    endpointId: "ep-refund",
    statusCode: "200",
    description: "退款已受理",
    contentType: "application/json",
    schema: { $ref: "#/components/schemas/RefundResult" },
    isError: false,
  },
];

const CONTEXT: PgContextRow = {
  entityId: "ep-refund",
  capabilityName: "订单退款",
  intent: "让用户对已支付订单发起退款",
  constraints: ["仅支持支付后 7 天内"],
  sideEffects: ["触发支付渠道退款"],
  usageScenarios: [{ when: "用户申请退款", then: "调用本接口" }],
  confidence: 0.9,
  editedByHuman: false,
};

const DEFINITIONS: PgDefinitionRow[] = [
  {
    entityType: "data_model",
    name: "RefundRequest",
    description: "退款请求体",
    kind: null,
    payload: { type: "object", properties: { amount: { type: "number" } } },
  },
  {
    entityType: "data_model",
    name: "RefundResult",
    description: null,
    kind: null,
    payload: { type: "object", properties: { refundId: { type: "string" } } },
  },
  {
    entityType: "component",
    name: "bearerAuth",
    description: "登录后获得的访问令牌",
    kind: "securityScheme",
    payload: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
  },
];

const INDEX_REQUEST = { repositoryId: "repo-1" };
const SCOPE = { repositoryIds: ["repo-1"] };

// ───────────────────────────────────────────────────────────────────
// 验收：有 / 无业务上下文
// ───────────────────────────────────────────────────────────────────

describe("pgDocumentSource — 有业务上下文的接口", () => {
  const source = pgDocumentSource({
    sql: fakeSql({
      repository: [REPO],
      defaultCommit: [{ commitId: "commit-1" }],
      endpoints: [endpoint()],
      responses: RESPONSES,
      contexts: [CONTEXT],
      definitions: DEFINITIONS,
    }).sql,
  });

  it("产出 project / tag / endpoint / schema / rules 五个层级", async () => {
    const documents = await source.load(INDEX_REQUEST, SCOPE);

    expect(documents.map((doc) => doc.id)).toEqual([
      "project:overview",
      "tag:订单",
      "endpoint:POST:/orders/{id}/refund",
      "schema:POST:/orders/{id}/refund:request",
      "schema:POST:/orders/{id}/refund:response",
      "rules:POST:/orders/{id}/refund",
    ]);
    expect(documents.map((doc) => doc.level)).toEqual([
      "project",
      "tag",
      "endpoint",
      "schema",
      "schema",
      "rules",
    ]);
  });

  it("把业务上下文写进 L2 正文（能力名 / 意图 / 使用场景）", async () => {
    const documents = await source.load(INDEX_REQUEST, SCOPE);
    const doc = documents.find((item) => item.level === "endpoint");

    expect(doc?.text).toContain("Capability:\n订单退款");
    expect(doc?.text).toContain("Intent:\n让用户对已支付订单发起退款");
    expect(doc?.text).toContain("Usage scenarios:");
  });

  it("L3 rules 承载约束与副作用，并记录能力名与置信度", async () => {
    const documents = await source.load(INDEX_REQUEST, SCOPE);
    const rules = documents.find((item) => item.level === "rules");

    expect(rules?.text).toContain("Constraints:\n- 仅支持支付后 7 天内");
    expect(rules?.text).toContain("Side effects:\n- 触发支付渠道退款");
    expect(rules?.metadata).toMatchObject({ capabilityName: "订单退款", confidence: 0.9 });
  });

  it("展开 $ref 指向的模型定义（否则字段名永远召不回）", async () => {
    const documents = await source.load(INDEX_REQUEST, SCOPE);
    const request = documents.find((item) => item.id.endsWith(":request"));

    expect(request?.text).toContain("RefundRequest");
    expect(request?.text).toContain('"amount":{"type":"number"}');
  });

  it("把 securityScheme 渲染进 L0 的认证段落", async () => {
    const documents = await source.load(INDEX_REQUEST, SCOPE);
    const project = documents.find((item) => item.level === "project");

    expect(project?.text).toContain("Authentication:\n- bearerAuth (http, bearer, JWT)");
  });

  it("层级用 parentId 串起来，且 parent 一定在同一次产出里", async () => {
    const documents = await source.load(INDEX_REQUEST, SCOPE);
    const ids = new Set(documents.map((doc) => doc.id));

    for (const doc of documents) {
      if (doc.parentId) expect(ids.has(doc.parentId)).toBe(true);
    }
    expect(documents.find((doc) => doc.level === "tag")?.parentId).toBe("project:overview");
    expect(documents.find((doc) => doc.level === "rules")?.parentId).toBe(
      "endpoint:POST:/orders/{id}/refund",
    );
  });

  it("每个文档都带 repository scope 所需的 organizationId 快照", async () => {
    const documents = await source.load(INDEX_REQUEST, SCOPE);

    expect(documents.every((doc) => doc.organizationId === "org-1")).toBe(true);
  });
});

describe("pgDocumentSource — 无业务上下文的接口", () => {
  const source = pgDocumentSource({
    sql: fakeSql({
      repository: [REPO],
      defaultCommit: [{ commitId: "commit-1" }],
      endpoints: [endpoint()],
      responses: RESPONSES,
      contexts: [],
      definitions: DEFINITIONS,
    }).sql,
  });

  it("仍产出 L2 + L3 schema，但**没有** rules 文档", async () => {
    const documents = await source.load(INDEX_REQUEST, SCOPE);

    expect(documents.some((doc) => doc.level === "rules")).toBe(false);
    expect(documents.some((doc) => doc.level === "endpoint")).toBe(true);
    expect(documents.some((doc) => doc.level === "schema")).toBe(true);
  });

  it("L2 正文里不出现业务上下文段落", async () => {
    const documents = await source.load(INDEX_REQUEST, SCOPE);
    const doc = documents.find((item) => item.level === "endpoint");

    expect(doc?.text).not.toContain("Capability:");
    expect(doc?.text).not.toContain("Intent:");
    expect(doc?.metadata).not.toHaveProperty("hasBusinessContext");
  });

  it("接口仍可被检索：method / path / summary 都在正文与 fields 里", async () => {
    const documents = await source.load(INDEX_REQUEST, SCOPE);
    const doc = documents.find((item) => item.level === "endpoint");

    expect(doc?.text.startsWith("POST /orders/{id}/refund")).toBe(true);
    expect(doc?.fields).toMatchObject({
      method: "POST",
      path: "/orders/{id}/refund",
      summary: "发起退款",
      tags: ["订单"],
    });
  });
});

// ───────────────────────────────────────────────────────────────────
// 边界与防御
// ───────────────────────────────────────────────────────────────────

describe("pgDocumentSource — 边界", () => {
  it("scope 里没有该仓库 → 空数组，且一次 SQL 都不发", async () => {
    const fake = fakeSql({ repository: [REPO] });
    const source = pgDocumentSource({ sql: fake.sql });

    expect(await source.load(INDEX_REQUEST, { repositoryIds: ["other"] })).toEqual([]);
    expect(fake.calls).toHaveLength(0);
  });

  it("仓库不存在 → 空数组", async () => {
    const source = pgDocumentSource({ sql: fakeSql({ repository: [] }).sql });

    expect(await source.load(INDEX_REQUEST, SCOPE)).toEqual([]);
  });

  it("主版本还没有 head commit（未导入过）→ 空数组，不报错", async () => {
    const fake = fakeSql({ repository: [REPO], defaultCommit: [{ commitId: null }] });
    const source = pgDocumentSource({ sql: fake.sql });

    expect(await source.load(INDEX_REQUEST, SCOPE)).toEqual([]);
    expect(fake.called("endpoints")).toBe(false);
  });

  it("显式传 commitId 时不再查主版本 head", async () => {
    const fake = fakeSql({
      repository: [REPO],
      endpoints: [endpoint()],
      responses: [],
      contexts: [],
      definitions: [],
    });
    const source = pgDocumentSource({ sql: fake.sql });

    const documents = await source.load({ ...INDEX_REQUEST, commitId: "commit-x" }, SCOPE);

    expect(fake.called("defaultCommit")).toBe(false);
    expect(documents.every((doc) => doc.metadata?.commitId === "commit-x")).toBe(true);
  });

  it("部分重索引只收窄 endpoint 级文档，project / tag 仍全量产出", async () => {
    const other = endpoint({
      id: "ep-ship",
      identityKey: "GET:/shipments/{id}",
      operationId: "getShipment",
      method: "GET",
      path: "/shipments/{id}",
      summary: "查询发货单",
      tags: ["物流"],
    });

    const documents = await pgDocumentSource({
      sql: fakeSql({
        repository: [REPO],
        defaultCommit: [{ commitId: "commit-1" }],
        endpoints: [endpoint(), other],
        responses: [],
        contexts: [],
        definitions: [],
      }).sql,
    }).load({ ...INDEX_REQUEST, endpoints: ["refundOrder"] }, SCOPE);

    const ids = documents.map((doc) => doc.id);
    expect(ids).toContain("endpoint:POST:/orders/{id}/refund");
    expect(ids).not.toContain("endpoint:GET:/shipments/{id}");
    // project 与 tag 不受过滤影响（对账时不能用它们反推「只剩一个接口」）。
    expect(ids).toContain("project:overview");
    expect(ids).toContain("tag:订单");
    expect(ids).toContain("tag:物流");
    // tag 正文说明它列了几个接口 —— 这里如实反映全量。
    const tag = documents.find((doc) => doc.id === "tag:物流");
    expect(tag?.metadata).toMatchObject({ endpointCount: 1 });
  });

  it("没有 tag 的接口归入 untagged，而不是丢掉", async () => {
    const documents = await pgDocumentSource({
      sql: fakeSql({
        repository: [REPO],
        defaultCommit: [{ commitId: "commit-1" }],
        endpoints: [endpoint({ tags: [] })],
        responses: [],
        contexts: [],
        definitions: [],
      }).sql,
    }).load(INDEX_REQUEST, SCOPE);

    expect(documents.map((doc) => doc.id)).toContain("tag:untagged");
    expect(documents.find((doc) => doc.level === "endpoint")?.parentId).toBe("tag:untagged");
  });

  it("没有参数也没有 requestBody → 不产出 request 文档", async () => {
    const documents = await pgDocumentSource({
      sql: fakeSql({
        repository: [REPO],
        defaultCommit: [{ commitId: "commit-1" }],
        endpoints: [endpoint({ parameters: [], requestSchema: null })],
        responses: [],
        contexts: [],
        definitions: [],
      }).sql,
    }).load(INDEX_REQUEST, SCOPE);

    expect(documents.some((doc) => doc.id.endsWith(":request"))).toBe(false);
  });

  it("jsonb 形状异常（parameters 是对象而不是数组）不会炸", async () => {
    const documents = await pgDocumentSource({
      sql: fakeSql({
        repository: [REPO],
        defaultCommit: [{ commitId: "commit-1" }],
        endpoints: [endpoint({ parameters: { name: "id" }, requestSchema: null })],
        responses: [],
        contexts: [],
        definitions: [],
      }).sql,
    }).load(INDEX_REQUEST, SCOPE);

    expect(documents.some((doc) => doc.level === "endpoint")).toBe(true);
  });
});

describe("pgDocumentSourceProvider", () => {
  it("从 deps.sql 取句柄", async () => {
    const fake = fakeSql({
      repository: [REPO],
      defaultCommit: [{ commitId: "commit-1" }],
      endpoints: [],
      responses: [],
      contexts: [],
      definitions: [],
    });

    const source = pgDocumentSourceProvider({ options: {}, deps: { sql: fake.sql } });

    await expect(source.load(INDEX_REQUEST, SCOPE)).resolves.toHaveLength(1);
  });

  it("deps 里没有 SqlExecutor → 启动期可读错误（不是运行期 undefined is not a function）", () => {
    expect(() => pgDocumentSourceProvider({ options: {}, deps: {} })).toThrow(RagConfigError);
    expect(() => pgDocumentSourceProvider({ options: {}, deps: {} })).toThrow(/deps\.sql/);
  });
});
