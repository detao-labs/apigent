import { describe, it, expect } from "vitest";
import {
  collectSchemaRefs,
  detectLang,
  renderEndpointText,
  renderProjectText,
  renderRequestSchemaText,
  renderResponseSchemaText,
  renderRulesText,
  renderTagText,
  type PgEndpointRow,
} from "./document-text";

const BASE_ENDPOINT: PgEndpointRow = {
  id: "ep-1",
  identityKey: "refundOrder",
  operationId: "refundOrder",
  method: "POST",
  path: "/orders/{id}/refund",
  summary: "发起退款",
  description: null,
  requestContentType: null,
  requestSchema: null,
  parameters: [],
  tags: null,
  deprecated: false,
};

describe("detectLang", () => {
  it("含 CJK → zh", () => {
    expect(detectLang("发起退款")).toBe("zh");
    expect(detectLang("Refund endpoint 退款")).toBe("zh");
  });

  it("纯英文 → en", () => {
    expect(detectLang("Create a refund")).toBe("en");
    expect(detectLang("POST /orders/{id}/refund")).toBe("en");
  });
});

describe("renderEndpointText", () => {
  it("空段落直接省略（同一份输入永远产出同一段文本）", () => {
    const text = renderEndpointText({ endpoint: BASE_ENDPOINT, responses: [] });

    expect(text).toBe("POST /orders/{id}/refund\nSummary:\n发起退款");
  });

  it("渲染参数的位置 / 类型 / 必填与说明", () => {
    const text = renderEndpointText({
      endpoint: {
        ...BASE_ENDPOINT,
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer" } },
        ],
      },
      responses: [],
    });

    expect(text).toContain("- id (path, string, required)");
    expect(text).toContain("- page (query, integer)");
  });

  it("参数形状不认识时跳过该条，而不是抛错", () => {
    const text = renderEndpointText({
      endpoint: {
        ...BASE_ENDPOINT,
        parameters: [null, "oops", { in: "query" }, { name: "ok", in: "query" }],
      },
      responses: [],
    });

    expect(text).toContain("- ok (query, unknown)");
    expect(text).not.toContain("oops");
  });

  it("标记 deprecated 与错误响应", () => {
    const text = renderEndpointText({
      endpoint: { ...BASE_ENDPOINT, deprecated: true },
      responses: [
        {
          endpointId: "ep-1",
          statusCode: "400",
          description: "参数错误",
          contentType: "application/json",
          schema: null,
          isError: true,
        },
      ],
    });

    expect(text).toContain("Deprecated:\nyes");
    expect(text).toContain("- 400 (application/json) [error]: 参数错误");
  });
});

describe("renderRequestSchemaText / renderResponseSchemaText", () => {
  it("把参数、body schema、content-type 都写进去", () => {
    const text = renderRequestSchemaText({
      endpoint: {
        ...BASE_ENDPOINT,
        requestContentType: "application/json",
        requestSchema: { type: "object" },
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      },
      definitions: new Map(),
    });

    expect(text).toContain("Request schema: POST /orders/{id}/refund");
    expect(text).toContain("Content-Type:\napplication/json");
    expect(text).toContain('Body schema:\n{"type":"object"}');
    expect(text).toContain("- id (path, string, required)");
  });

  it("响应侧逐状态码渲染 schema，并内联引用到的模型定义", () => {
    const text = renderResponseSchemaText({
      endpoint: BASE_ENDPOINT,
      responses: [
        {
          endpointId: "ep-1",
          statusCode: "200",
          description: "退款已受理",
          contentType: "application/json",
          schema: { $ref: "#/components/schemas/RefundResult" },
          isError: false,
        },
      ],
      definitions: new Map([
        [
          "RefundResult",
          {
            entityType: "data_model" as const,
            name: "RefundResult",
            description: "退款结果",
            kind: null,
            payload: { type: "object", properties: { refundId: { type: "string" } } },
          },
        ],
      ]),
    });

    expect(text).toContain("Response schema: POST /orders/{id}/refund");
    expect(text).toContain("- 200 (application/json): 退款已受理");
    expect(text).toContain('schema: {"$ref":"#/components/schemas/RefundResult"}');
    expect(text).toContain("RefundResult — 退款结果:");
  });
});

describe("renderRulesText", () => {
  it("只渲染存在的段落", () => {
    const text = renderRulesText({
      entityId: "ep-1",
      capabilityName: "订单退款",
      intent: null,
      constraints: null,
      sideEffects: null,
      usageScenarios: ["用户申请退款"],
      confidence: null,
      editedByHuman: false,
    });

    expect(text).toBe("Business rules\nUsage scenarios:\n- 用户申请退款");
  });

  it("约束是对象数组时按 key=value 渲染", () => {
    const text = renderRulesText({
      entityId: "ep-1",
      capabilityName: null,
      intent: null,
      constraints: [{ kind: "time", value: "7d" }],
      sideEffects: [],
      usageScenarios: null,
      confidence: null,
      editedByHuman: false,
    });

    expect(text).toContain("- kind=time value=7d");
  });
});

describe("renderProjectText / renderTagText", () => {
  it("project 文本包含仓库描述、能力上下文与认证方式", () => {
    const text = renderProjectText({
      repositoryName: "订单服务",
      repositoryDescription: "订单与支付",
      capabilityContext: { domain: "电商" },
      securitySchemes: [
        {
          entityType: "component",
          name: "bearerAuth",
          description: null,
          kind: "securityScheme",
          payload: { type: "http", scheme: "bearer" },
        },
      ],
    });

    expect(text).toContain("Repository: 订单服务");
    expect(text).toContain("Capability context:\n- domain: 电商");
    expect(text).toContain("- bearerAuth (http, bearer)");
  });

  it("tag 文本列出成员接口", () => {
    const text = renderTagText({ tag: "订单", endpoints: [BASE_ENDPOINT] });

    expect(text).toBe("Tag: 订单\nEndpoints:\n- POST /orders/{id}/refund — 发起退款");
  });
});

describe("collectSchemaRefs", () => {
  it("递归收集 schemas 引用并去重保序", () => {
    const refs = collectSchemaRefs({
      type: "object",
      properties: {
        a: { $ref: "#/components/schemas/Order" },
        b: { items: { $ref: "#/components/schemas/Order" } },
        c: { $ref: "#/components/schemas/Refund" },
      },
    });

    expect(refs).toEqual(["Order", "Refund"]);
  });

  it("忽略非 schemas 的引用（responses / parameters）", () => {
    expect(collectSchemaRefs({ $ref: "#/components/responses/NotFound" })).toEqual([]);
  });
});
