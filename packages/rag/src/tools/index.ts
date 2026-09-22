// ═══════════════════════════════════════════════════════════════════
// RAG Tools — 工具定义（`@apigent/rag/tools`）
// ═══════════════════════════════════════════════════════════════════
//
// 只含**定义**（name / description / inputSchema / scope），不含执行器 ——
// 与 packages/core 的 agent 工具同一约定：定义与执行器分离，四处各写各的
// 执行器，但 schema 只有这一份：
//
//   - agent 运行时：注册进 AgentToolRegistry（见 P6-2）
//   - MCP Gateway：放进 tools/list（见 P8-3）
//   - 平台客户端：展示工具清单时读这里，不重抄 schema
//
// 两个约束：
//   1. **只依赖 zod** —— 不 import core / db / native，客户端可安全引用；
//   2. **不被 `@apigent/rag` 顶层 import** —— 顶层将来会触及 db。
//
// ## 命名规则（见 CLAUDE.md → External Surface Naming）
//
// **工具名 snake_case、参数名 camelCase。** 两者角色不同：
//   - 工具名是**协议面的标识符** —— 出现在客户端配置 / 白名单 / 日志 / 审计里，
//     且与其他 server 共享命名空间（客户端聚合多个 server 时常加前缀）。跨系统的
//     标识符跟随生态惯例（`get_endpoint_spec`、`search_apis`）。
//   - 参数名是**本 server 自己的数据契约** —— 就是一段 JSON Schema 的 properties，
//     没有跨系统命名空间，用本地习语与内部类型一致，省掉一层字段名映射。
//
// MCP 规范对此的要求：只约束**工具名**（1–128 字符、大小写敏感、仅允许
// `[A-Za-z0-9_.-]`、server 内唯一），**对大小写风格中立**（其示例含 `getUser`），
// **对参数名完全未提**。所以上面的分工是我们的约定，不是规范强制。
// ═══════════════════════════════════════════════════════════════════

import { z } from "zod";

/**
 * 工具定义的最小形状 —— 与 `packages/core` 的 `AgentToolDefinition`
 * **结构兼容**，因此可以直接注册进 `AgentToolRegistry`，而无需让本包依赖 core。
 */
export interface RagToolDefinition<Input> {
  name: string;
  description: string;
  inputSchema: z.ZodType<Input>;
  /** 检索型工具一律在服务端执行 */
  scope: "server";
}

export const SEARCH_APIS_INPUT = z
  .object({
    /** 自然语言搜索意图，如「退款接口在哪里」 */
    query: z.string().min(1),
    /** 限定到某个仓库 */
    repositoryId: z.string().min(1).optional(),
    /** 限定到某个组织下的仓库 */
    organizationId: z.string().min(1).optional(),
    /** 限定到某个 Project（V1+；双层规则：project 成员 ∩ repo 权限） */
    projectId: z.string().min(1).optional(),
    /** 返回数量，默认取 fineRankTopK */
    topK: z.number().int().positive().max(50).optional(),
    /** fast 跳过查询改写；deep 走完整管线。缺省由检索层按查询特征自动选择。 */
    mode: z.enum(["fast", "deep"]).optional(),
  })
  .strict();

export type SearchApisInput = z.infer<typeof SEARCH_APIS_INPUT>;

export const searchApisTool: RagToolDefinition<SearchApisInput> = {
  name: "search_apis",
  description:
    "用自然语言描述意图，语义搜索最相关的 API。返回方法、路径、能力意图与匹配原因。" +
    "适合「实现某功能需要调哪些接口」这类问题；拿到结果后按需再取接口详情。" +
    "可选按仓库 / 组织 / 项目收窄范围。",
  inputSchema: SEARCH_APIS_INPUT,
  scope: "server",
};

/**
 * 本包暴露的全部工具。
 *
 * 注：**没有 `ask_apis`** —— P0-5 定案：RAG 只做检索，问答由需要答案的一方
 * 拿检索结果自行生成。
 */
export const RAG_TOOLS: RagToolDefinition<unknown>[] = [searchApisTool];
