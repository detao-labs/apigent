# RAG Package — 可替换的检索/问答能力包（技术设计）

> **状态：** 仅设计——尚未实现。配置槽（`rag.*`）、`knowledge_chunks` 表、`memory` 向量库已存在；embedding / pgvector / 检索管线均未接线。

> **类型：** Platform Service（确定性检索） + 可选 AI Agent（查询改写、答案生成、LLM-as-judge，均在包内以阶段形式存在）
> **版本：** V0（检索）/ V1（问答）
> **关联：** [semantic-search.agent.md](./semantic-search.agent.md)（检索算法细节）、[rag-observability.md](./rag-observability.md)（trace/metric 结构）、[rag-eval.agent.md](./rag-eval.agent.md)（评测）、[mcp-gateway.md](./mcp-gateway.md)（对外暴露）、[tech-design.md](../tech-design.md) §5.5（可扩展架构）

---

## 0. 本文档要回答的问题

1. RAG 如何封装成一个 npm 包，同时服务 **MCP tool** 与 **平台页面**；
2. 如何做到「**整体替换**」与「**局部配置替换**」；
3. 可观测性与评估如何内建，而不是事后补；
4. 现在动手实现之前，**哪些既有设计会挡路、必须先处理**（§9，本文档的重点）。

---

## 1. 定位与范围

一个包 `@apigent/rag`，承载「把 API 知识变成可检索的索引」和「把自然语言查询变成排序结果（可选生成答案）」两条链路。

**在范围内**

| 链路           | 内容                                                               |
| -------------- | ------------------------------------------------------------------ |
| 摄取（写路径） | 文档构建 → 分层分块 → 向量化 → 写入稠密/稀疏索引 → 对账清理        |
| 检索（读路径） | 查询改写 → 多路召回 → 融合粗排 → 精排 → 上下文扩展                 |
| 生成（可选）   | 基于召回结果生成带引用的回答（V1）                                 |
| 评测（离线）   | 黄金集 → 检索指标（hit@k / MRR / nDCG / 延迟 / 空召回）→ LLM-judge |
| 可观测         | 阶段 span、指标、降级标记（通过端口，不绑定具体后端）              |

**不在范围内**

- **鉴权 / 权限解析**：RBAC 只存在于 `@apigent/server`。RAG 接收调用方解析好的 `scope`，自己不做权限判断（理由见 §4.1）。
- **MCP 协议**：协议适配在 `apps/open`；RAG 只提供工具「定义」。
- **UI**：平台页面在 `apps/platform`。
- **知识卡片聚合**（`get_api_detail`）：那是 Knowledge Retrieval Service 的职责（纯 SQL JOIN，无 embedding），独立于本包。但两者共享同一套 API 标识符。

---

## 2. 包结构与边界

### 2.1 为什么是「一个包 + 分层 subpath」，而不是多个包

仓库现状：`packages/*` 不做构建，`main`/`exports` 直接指向 `.ts`，运行时（tsx / Next.js）直接消费源码。在这个前提下拆成 `rag-core` / `rag-pgvector` / `rag-qwen` 三四个包，只增加 package.json 与依赖管理成本，拿不到隔离收益——隔离应该靠**模块边界 + lint 约束**，而不是 package 边界。

同时，「整体可替换」要求对外暴露的接口面**尽可能小**。这两点不冲突：用 subpath exports 切层，消费者默认只 import 顶层，其余 subpath 是给「愿意替换某个阶段」的人用的。

将来真要拆包，只要没有跨层私通 import，就是机械搬迁。

### 2.2 目录与导出

```
packages/rag/
  package.json          # exports 见下表；依赖：@apigent/core/config, ai, zod, drizzle-orm, pg
  src/
    index.ts            # createRagService() —— 唯一的消费入口
    contracts/          # 零重依赖：类型 + 接口 + 错误 + 常量（客户端可安全 import）
    pipeline/           # 纯编排：组装阶段、跑检索、跑摄取；不含任何具体 provider
    stages/             # 各阶段的内置默认实现（纯函数优先）
    adapters/           # 具体后端：pgvector / pg-fts / qwen / openai / cohere / hash(测试)
    tools/              # search_apis / ask_apis 工具定义（zod，无执行器）
    testing/            # 确定性替身：hashEmbedder、memoryIndex、RecordingTelemetry
    eval/               # 评测 harness + 指标计算
```

| Subpath                   | 内容                                           | 客户端可 import？   |
| ------------------------- | ---------------------------------------------- | ------------------- |
| `@apigent/rag`            | `createRagService(config, deps)`、服务接口类型 | ❌ 会触及 db/pg     |
| `@apigent/rag/contracts`  | 查询/结果/scope/trace 类型，错误类，枚举常量   | ✅ 零重依赖         |
| `@apigent/rag/tools`      | 工具名 / description / zod inputSchema         | ✅ 仅依赖 zod       |
| `@apigent/rag/testing`    | 测试替身                                       | ✅ 但只应出现在测试 |
| `@apigent/rag/eval`       | 评测入口                                       | ❌ 服务端/脚本      |
| `@apigent/rag/adapters/*` | 具体实现                                       | ❌                  |

### 2.3 依赖方向（必须遵守，否则成环）

```
@apigent/core（/config + /ai）  ←──  @apigent/rag  ──→  ai (AI SDK) / zod / @node-rs/jieba
                                          ▲
                                          │ 只此一个方向
                                          │
                                    @apigent/server        （rag/index.ts：绑定 DB 句柄 + 注册 provider）
                                          ▲
                                          │
                                apps/platform · apps/open · scripts
```

- `@apigent/rag` **禁止** import `@apigent/server*`。DB 访问通过**注入的最小端口**（`SqlExecutor`，只有一个 `query(sql, params)`），而不是自己去 `getDB()`——这也让 rag 不依赖 `drizzle-orm` / `pg`。
- **模型调用能力来自 `@apigent/core/ai`**（工厂模式）；**只有 RAG 需要的 embedding / rerank 放在 rag 自己**（P0-1 定案）。
- 绑定与注册放在 `@apigent/server/src/rag/index.ts`，形态与既有的 `registerQueueProviders(container)` 完全同构。
- 这与 `packages/core` 不能依赖 `packages/server` 的既有约定方向一致。

> **建议加一条 lint 规则**：`packages/rag/**` 里出现 `@apigent/server` 直接报错。这类约束靠人记不住。

### 2.4 客户端边界（复用 CLAUDE.md 既有规则）

CLAUDE.md 已明确：客户端组件不能 value-import 任何（传递地）触及 `@apigent/server/db` 的 barrel，否则 `next build` 会把 `pg` / node 内置模块打进浏览器包。

`@apigent/rag` 顶层必然触及 db。因此：

- 平台**服务端**（Route Handler / server component）用 `@apigent/rag`；
- 平台**客户端组件**需要工具清单、字段枚举时，只 import `@apigent/rag/contracts` 与 `@apigent/rag/tools`；
- 检索请求一律走 API route，浏览器不直连检索服务。

---

## 3. 三级可替换模型

这是本方案的核心。要求「可整体替换，也可局部配置替换」，落地为三个层次，**互不排斥**：

### L0 — 整体替换（整个管线）

用一个接口兑掉整条链路，适合「客户已有自己的 RAG 服务（Dify / 自研 / 托管）」。

```yaml
# apigent.config.yaml
rag:
  provider: "@acme/apigent-rag-qdrant" # 内置枚举值，或已安装的 npm 包名
```

```ts
// 客户实现的最小接口面（不含 answer —— P0-5 定案）
interface RagService {
  index(req: IndexRequest): Promise<IndexReport>;
  retrieve(req: RetrieveRequest): Promise<RetrieveResult>;
  health(): Promise<RagHealth>;
}
```

只要实现这 3 个方法，平台页面、agent 运行时、MCP、评测全部照常工作——因为它们是**同一套契约**的四个薄适配器（§6）。

**用户流程：`pnpm add <包>` → YAML 写包名 → 重启 → 生效。**

### L1 — 局部配置替换（按阶段换实现）

即现有的 `rag.*` 配置槽：换 reranker 从 qwen 到 cohere，改一行 YAML。这一层已经设计好了（`types.ts` + `schema.ts` + `defaults.ts`），本方案不改动它的形态，只是补齐**读取它的代码**。

### L2 — 局部代码替换（按阶段换定制实现）

只替换某一个阶段，其余保持内置：

```yaml
rag:
  retrieval:
    reranker:
      provider: "@acme/apigent-rerank-v2" # 内置枚举（none | qwen | cohere | bge-reranker）或 npm 包名
```

**统一规则（P0-6 定案）：任何 `provider` 字段都接受「内置枚举值 | npm 包名」两种形态。**

**为什么写包名而不是文件路径：** 文件路径会让配置文件变成任意代码执行入口（配置文件常被复制、被工单传递）。包名要求该包**已安装为依赖**，门槛与可审计性高得多，但「改一行配置 + 重启」的体验完全保留。

**实现三要点：**

1. **启动期自检** —— 加载所有配置声明的 provider 并校验导出形状，不合格则启动失败并给出可读错误（同时给「重启后生效」一个明确的成功 / 失败信号）；
2. **类型** —— 第三方包把提供接口的包声明为 **peerDependency**，避免多装出多份副本；
3. **运行时形状校验** —— TS 类型运行时不可见，需手写检查或 zod 校验导出。

**开发期仍在 `apigent.config.ts` 注册** —— 本地文件路径 / 内联 factory：生产用 YAML 包名，开发用 config.ts。

```ts
// apigent.config.ts
export default {
  providers: { "rag.reranker": { local: (cfg) => new MyReranker(cfg) } },
} satisfies ApigentConfig;
```

实现上是**阶段注册表 + fail-fast**：每个阶段一张 `name → factory` 表，内置实现由 `@apigent/rag` 注册，包名实现在启动期动态 import 后注册；配置里写了加载不到的名字，在**启动期**就抛错（沿用容器既有契约，不做静默回退）。

### 3.1 阶段的接口约定

所有阶段接口只接受/返回**纯 JSON 可序列化**的值：不传 ORM 行、不传数据库句柄（句柄只进构造函数）、不传 Buffer。

这条约束换来两件事：

1. 任意阶段都可以是**进程外实现**（例如把 embedding 换成一个 HTTP 服务），不需要改管线；
2. 评测可以录制/回放阶段输入输出，指标可复现。

### 3.2 可插拔面要克制

每多开放一个可插拔阶段，配置校验、文档、测试矩阵就翻一倍。建议的优先级：

| 阶段            | 是否开放替换 | 理由                                                            |
| --------------- | ------------ | --------------------------------------------------------------- |
| Embedder        | ✅ 必做      | 换云厂商的第一诉求；也是唯一无法用配置绕过的一环                |
| DenseIndex      | ✅ 必做      | pgvector ↔ Milvus/Qdrant 是已承诺的能力                         |
| SparseIndex     | ✅ 必做      | 中文分词方案差异极大（§9 A3），必须有退路                       |
| Reranker        | ✅ 必做      | 成本/质量权衡点，且「关掉」是常用配置                           |
| QueryRewriter   | ✅ 必做      | 涉及 LLM 成本与延迟，必须能整体关闭                             |
| Telemetry       | ✅ 必做      | 见 §7，端口化是本方案的关键前提                                 |
| Chunker         | ⚠️ 只做枚举  | `hierarchical` / `fixed` 足够；过早开放会诱使人在分块上过度调参 |
| Fusion          | ⚠️ 只做枚举  | `rrf` / `linear` 是纯函数，枚举即可                             |
| ContextExpander | ⚠️ 先不做    | 内置按 `parent_id` / `level` 取，属产品逻辑而非基础设施         |
| AnswerGenerator | 🟡 V1 再说   | V0 只做检索时不需要                                             |
| Cache           | 🟡 只留接口  | 见 §9 D3，V0 用进程内 LRU                                       |

---

## 4. 契约

### 4.1 为什么 `scope` 是必填

```ts
interface RagScope {
  /** 必填。调用方已解析完成的可见仓库集合。空数组 = 无权限 → 直接返回空结果 */
  repositoryIds: string[];
  /** 收窄到组织（可选） */
  organizationId?: string;
  /** V1+：收窄到 Project（双层规则：project 成员 ∩ repo 权限） */
  projectId?: string;
  /** 收窄版本；缺省 = 各仓库的活跃版本 */
  versionIds?: string[];
}
```

设计取舍：**RAG 包不做鉴权**，因为四个调用方的权限来源完全不同——平台用 session 用户、MCP 用 SecretKey 的 owner + key 白名单、agent 运行时用 session + 页面上下文、评测**没有用户**（用固定 fixture scope）。若把 RBAC 塞进 RAG 包：

1. 评测无法复用同一条管线（指标就不代表生产）；
2. 会诞生第二套授权模型，与「authorization stays in packages/server」的既有决策冲突；
3. `@apigent/rag` 被迫依赖 `@apigent/server`，直接成环。

代价是**调用方可能忘记传 scope**。对策：字段设计为必填、类型上不存在「不传 = 全库」的形态，且四个调用方统一走 `@apigent/server` 的 `resolveSearchScope()`（§6.2）。默认全库搜索是这类系统的典型漏洞，必须在类型层面排除。

### 4.2 检索

```ts
interface RetrieveRequest {
  query: string;
  scope: RagScope;
  topK?: number; // 默认取 rag.retrieval.fineRankTopK
  mode?: "fast" | "deep"; // 覆盖自动策略；deep 才允许 LLM 改写
  filters?: {
    methods?: string[];
    tags?: string[];
    pathPrefix?: string;
  };
  expand?: boolean; // 是否做上下文扩展，默认 true
  rerank?: boolean; // 默认 true；评测做 A/B 对照时需要关
  includeDebug?: boolean; // 返回各路分数与阶段耗时
}

interface RetrieveResult {
  query: string;
  rewrittenQuery?: string;
  strategy: "hybrid" | "dense" | "sparse" | "kg" | "fallback";
  results: RetrievedChunk[];
  totalCandidates: number;
  /** 降级信息必须进结果，不能只进 trace —— UI 要展示、评测要断言、MCP 要提示 */
  degraded?: {
    reason: "embedding_unavailable" | "index_empty" | "rerank_failed" | "rewrite_failed";
    detail?: string;
  };
  trace: RagTraceSummary;
}

interface RetrievedChunk {
  chunkKey: string;
  repositoryId: string;
  level: ChunkLevel;
  method?: string;
  path?: string;
  summary?: string;
  /** 最终排序分（0-1） */
  score: number;
  /** 粗排 / 精排分，便于调试与评测对比 */
  coarseScore?: number;
  fineScore?: number;
  /** 为什么匹配（给人看，也是 LLM 生成答案时的依据） */
  matchReason?: string;
  highlights?: Array<{ field: string; snippet: string }>;
  /** 命中后按 parent 扩展出的上下文（规则、tag 概述、示例） */
  context?: Array<{ level: ChunkLevel; content: string }>;
}

interface RagTraceSummary {
  traceId: string;
  latencyMs: number;
  stageMs: Record<string, number>;
  llmCalls: number;
  tokens?: { input: number; output: number };
  costUsd?: number;
  cacheHit?: boolean;
}
```

`matchReason` / `highlights` / `degraded` / `trace` 四者必须在**第一版契约里**就有。它们是 UI 的「为什么返回这个」、评测的「为什么没命中」、以及排障的共同依赖；等到 UI 阶段再补，会同时牵动 MCP 与前端。

### 4.3 摄取

```ts
interface IndexRequest {
  repositoryId: string;
  versionId?: string; // 缺省 = 该仓库的活跃版本
  endpoints?: string[]; // 只重索引部分接口
  force?: boolean; // 忽略 contentHash 复用
}

interface IndexReport {
  chunksWritten: number;
  chunksSkipped: number;
  chunksDeleted: number;
  tokens: number;
  costUsd?: number;
  durationMs: number;
  degraded?: { reason: string; detail?: string };
}
```

### 4.4 文档源（摄取的输入，也是「知识从哪来」的唯一定义）

```ts
interface RagDocumentSource {
  load(req: IndexRequest, scope: { repositoryIds: string[] }): Promise<RagDocument[]>;
}

interface RagDocument {
  /** 稳定 ID，参与 chunk_key 构造 */
  id: string;
  level: "project" | "tag" | "workflow" | "endpoint" | "schema" | "rules";
  lang: "zh" | "en";
  /** 用于向量化的正文 */
  text: string;
  /** 结构化字段，供稀疏检索加权（method/path 高权重） */
  fields?: { method?: string; path?: string; summary?: string; tags?: string[] };
  metadata: Record<string, unknown>;
  parentId?: string;
}
```

内置实现 `pg-document-source` 从 `endpoints` + `endpoint_responses` + `business_contexts` + `components` 组装文档。**它是「API 知识 → 可检索文本」的唯一权威定义**，改这里等于改检索质量；把它做成一个阶段而不是散落在 SQL 里，是为了让评测能直接对「文档构建」做 A/B。

---

## 5. 阶段清单

| 阶段       | 接口                | 内置实现                                             | 配置槽                       |
| ---------- | ------------------- | ---------------------------------------------------- | ---------------------------- |
| 文档构建   | `RagDocumentSource` | `pg-document-source`                                 | —                            |
| 分块       | `Chunker`           | `hierarchical` / `fixed`                             | `rag.chunkStrategy`          |
| 向量化     | `Embedder`          | qwen / openai / cohere / local-bge / local-fastembed | `rag.embedding`              |
| 稠密索引   | `DenseIndex`        | pgvector / memory                                    | `rag.vectorStore`            |
| 分词       | `Tokenizer`         | jieba（应用侧，`cutForSearch`）/ bigram / simple     | `rag.searchStore` 的变体     |
| 稀疏索引   | `SparseIndex`       | pg-fts（见 §9 A3）/ none                             | `rag.searchStore`            |
| 图召回     | `GraphExpander`     | none（V1+ KG）                                       | `rag.knowledgeGraph`         |
| 查询改写   | `QueryRewriter`     | 规则+LLM / noop                                      | `rag.queryRewrite`           |
| 融合       | `Fusion`            | rrf / linear                                         | `rag.retrieval.fusionMethod` |
| 精排       | `Reranker`          | qwen / cohere / bge-reranker / none                  | `rag.retrieval.reranker`     |
| 上下文扩展 | `ContextExpander`   | builtin                                              | —（新增槽位）                |
| 生成       | `AnswerGenerator`   | LLM（AI SDK）                                        | —（V1 新增）                 |
| 可观测     | `RagTelemetry`      | noop / logger / otlp / langfuse                      | `observability.*`            |
| 缓存       | `RagCache`          | noop / memory-lru                                    | —（新增槽位）                |

**摄取的写入策略必须是「对账式」（desired-set diff），不能只做 upsert。**

理由：新版本删掉了某个接口后，它的 `chunk_key` 不在新集合里；只 upsert 的话这条 chunk 会永远留在索引中，并且**仍然可以被检索到**——那是一个内容泄漏面（已删除的接口还能被搜出来）。正确做法：算出本次期望的 `chunk_key` 全集 → upsert 变更项 → 删除该 `(repository, version)` 下不在集合内的行。

---

## 6. 四个消费端点如何接入

```
                        @apigent/rag
                    createRagService()  ← 同一条管线
                              ▲
        ┌─────────────┬───────┴───────┬─────────────────┐
        │             │               │                 │
  平台 API route   agent 运行时工具   MCP tool       评测 harness
  POST /api/search  @apigent/rag/tools  @apigent/rag/tools  pnpm rag:eval
        │             │               │                 │
      浏览器      /api/agent/run   :3002/mcp      （无用户，固定 scope）
```

四个适配器各自只做两件事：**解析 scope**、**把结果映射成自己的出参格式**。

### 6.1 工具定义只写一次

`@apigent/rag/tools` 导出 `search_apis`（+ V1 的 `ask_apis`）的 name / description / zod schema，**不含执行器**。这与既有的 `packages/core/src/agent` 注册表模式一致（定义与执行器分离）：

- agent 运行时：把定义注册进 `AgentToolRegistry`，执行器复用平台已有 service（可在 V0 就上线，不被 MCP 阻塞）；
- MCP Gateway：把同一份定义放进 `tools/list`，执行器直连 `RagService`；
- 平台客户端：需要展示工具清单 / MCP 连接卡时，从 `@apigent/rag/tools` 读，不重复抄 schema。

### 6.2 scope 解析必须收敛成一个函数

```ts
// @apigent/server —— 唯一的权限交集实现
async function resolveSearchScope(input: {
  userId: string;
  repositoryId?: string;
  organizationId?: string;
  projectId?: string;
  /** MCP：SecretKey 的仓库白名单（空 = 不限制） */
  keyRepositoryIds?: string[];
}): Promise<RagScope | { denied: true }>;
```

交集规则（沿用既有 RBAC）：`listAccessibleRepositoryIds(userId)` ∩ `keyRepositoryIds`（空视为不限制）∩ `repositoryId` / `organizationId` / `projectId` 收窄条件。单仓库搜索要先 `assertRepoAccess`，无权限直接 403，而不是返回空列表。

**这个函数必须在四个调用方之间共享。** 抄四遍迟早抄出一个泄漏——这是本方案里最容易被忽略的正确性风险。

### 6.3 与既有模块的关系

| 既有模块                         | 交互                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/core/src/agent`        | 新增 `search_apis` 工具定义（来自 `@apigent/rag/tools`）+ server 执行器              |
| `apps/platform` `/api/agent/run` | 注册上面的执行器，助手抽屉即可用 RAG                                                 |
| `apps/open`（MCP）               | 依赖 `verifySecretKey()`（尚未实现，§9 C5）与 `repo:manage_mcp` 开关                 |
| `contexts`（业务上下文）         | 上下文是 endpoint chunk 的语义主体；上下文保存后需要重索引该接口                     |
| `imports`（导入 worker）         | 导入成功 / 版本激活后投递 `vectorize` 任务（`repository_tasks.taskType` 已预留该值） |
| `queue`                          | 复用 Postgres 队列 + `repository_tasks` + 通知，与 `context_tasks` 同构              |

---

## 7. 可观测性设计

### 7.1 端口化，而不是直接依赖 OTel

`@apigent/rag/contracts` 定义 `RagTelemetry` 端口，默认 `NoopTelemetry`：

```ts
interface RagTelemetry {
  startSpan(name: RagSpanName, attrs: RagSpanAttributes): RagSpan;
  recordMetric(name: RagMetricName, value: number, attrs?: Record<string, unknown>): void;
}

interface RagSpan {
  setAttribute(key: string, value: unknown): void;
  end(status?: "ok" | "error"): void;
}
```

**RAG 代码里不允许出现 `import { trace } from "@opentelemetry/api"`。** 三条理由：

1. 现在的可观测性基建还没落地（`observability.provider` 有 4 个枚举、0 个实现，OTel 依赖未安装）。如果 RAG 直接调 OTel，就会把「可观测性平台选型」变成 RAG 的发布阻塞项。
2. 评测需要断言「是否降级、各阶段命中数」——`RecordingTelemetry` 比解析 OTLP 简单得多。
3. fail-open 的边界清晰：telemetry 抛错不能影响检索。

### 7.2 `provider: none` 时落到现有结构化日志

仓库已有 pino + AsyncLocalStorage 日志（阶段 A/B 已完成）。RAG 的 telemetry 默认实现 `LoggerTelemetry` 直接输出结构化事件：

```
{"ts":…,"level":"info","event":"rag.query","traceId":"…","reqId":"…","repositoryCount":3,"mode":"fast","topK":10}
{"ts":…,"level":"info","event":"rag.stage","stage":"retrieve.dense","hits":50,"ms":38}
{"ts":…,"level":"warn","event":"rag.degraded","reason":"embedding_unavailable"}
```

于是**RAG 上线第一天就可观测**（能 grep、能算空召回率与降级率），OTel 阶段 C 落地后只需要再加一个 adapter，检索代码一行不动。

### 7.3 trace 结构与既有文档对齐

沿用 [rag-observability.md](./rag-observability.md) 的 span 命名，root `rag.query` 下挂 `rewrite` / `retrieve.dense` / `retrieve.sparse` / `retrieve.kg` / `fusion` / `rerank` / `expand` / `answer`。属性 schema 用类型化的 `RagSpanAttributes`，换后端不改调用点。

### 7.4 关联 ID 必须与日志同源（见 §9 D2）

root span 的 `traceId` 应与现有 `LoggingContext` 的 `reqId` / `taskId` 打通，否则日志与 trace 是两套 ID，排障时只能人工对齐。

### 7.5 脱敏默认值

| 内容                                       | 默认       | 开关                                         |
| ------------------------------------------ | ---------- | -------------------------------------------- |
| 查询原文                                   | 记录       | `rag.telemetry.recordQueryText`（默认 true） |
| 改写后的查询                               | 记录       | 同上                                         |
| chunk 正文 / 业务文档内容                  | **不记录** | 不提供开关（需要时走本地调试）               |
| 分数 / 命中数 / 耗时 / 模型 / token / 成本 | 记录       | —                                            |

查询原文必须记录，否则「检索为什么变差」无法归因；业务文档正文默认不外发，避免把客户的 OpenAPI 内容送进第三方追踪平台。

### 7.6 指标最小集

| 指标                       | 类型      | 用途                    |
| -------------------------- | --------- | ----------------------- |
| `rag.query.latency`        | histogram | 端到端                  |
| `rag.stage.latency{stage}` | histogram | 定位瓶颈                |
| `rag.recall.empty_rate`    | gauge     | 空召回                  |
| `rag.fallback_rate`        | gauge     | 降级占比                |
| `rag.rewrite.cache_hit`    | counter   | 改写缓存效果 → LLM 成本 |
| `rag.cost_per_query`       | counter   | token + 货币成本        |

---

## 8. 评估设计

### 8.1 两条硬约束

1. **评测必须走生产同一条管线。** 同一个 `createRagService()`，只替换 `scope` / `telemetry` / `cache`（评测关闭缓存）。自己写一套检索的评测器，指标不代表生产，属于自欺。
2. **CI 必须能在没有 API key 的情况下跑检索指标。** `@apigent/rag/testing` 提供 `hashEmbedder`（确定性伪向量）+ `memoryIndex`，使 hit@k / MRR / nDCG 这类**排序指标**可在无网络环境验证；延迟指标与 LLM-judge 只在本地 / 夜间跑。

第 2 条对管线设计有要求：**所有阶段必须靠注入组装，管线内不得有隐藏的全局单例**。这个约束要在写第一行 pipeline 代码时就成立，事后补代价很大。

### 8.2 指标与门禁

沿用 [rag-eval.agent.md](./rag-eval.agent.md) 的两层设计（检索指标确定性计算 + LLM-as-judge），并明确：

- `hit@k` / `MRR` / `nDCG` 是**排序质量**；`empty_rate` / `fallback_rate` 是**可用性**；两者要分开看——空召回率上升往往先于 hit@k 下降暴露问题。
- `unanswerable` 查询（应当无结果）单独统计：命中即失败，不计入 hit@k。它衡量的是「该拒答时有没有乱给」。
- 阈值放配置（`rag.eval.thresholds`），不放代码。

### 8.3 黄金集与索引快照（见 §9 D4）

黄金集 `data/rag-eval/golden.json`（`data/` 未被 gitignore，可提交），字段含 `datasetVersion`、`query`、`expected_api_ids`、`unanswerable?`；变更必须 bump 版本，否则回归对比失真。

评测必须能**冻结索引**：golden set 指向的仓库内容一旦变化，指标不可比。做法二选一：

- **固定 fixture**（推荐）：seed 脚本把固定 OpenAPI 样例导入到固定 repo id，评测前重建索引；
- **chunks 快照**：导出/导入 chunk 集合（适合大集合，但快照本身要版本化）。

报告产物输出 JSON + Markdown；只把 baseline 提交进仓库，每轮的临时报告 gitignore。

---

## 9. 影响现有开发、需要提前处理的问题

以下按「返工代价 × 紧急度」排序。**P0 = 动手写 RAG 之前必须定，否则要写两遍；P1 = 同批次处理；P2 = 记录在案。**

### A. 必须先把这三件事定下来

#### A1 (P0) — LLM / Embedding 目前是「双轨制」，必须先收敛

> ✅ **已定案（2026-09-22）：按「谁需要」切分，不按「是不是 AI」切分。**
>
> - **`@apigent/core/ai` = 调用模型服务的能力**（工厂模式）：`createLanguageModel(flow)` + 通用 provider 传输层。
> - **`@apigent/rag` = 只有 RAG 需要的东西**：embedding 模型工厂、rerank 客户端、分词器、管线与适配器。
> - 端口类型直接用 AI SDK 的 `LanguageModel` / `EmbeddingModel`；**删除**自定义 `LLMProvider` / `EmbeddingProvider` 与容器里的死 stub。
> - `@apigent/server/ai` 保留为 re-export，现有调用点零改动。

**现状（证据）：**

- `packages/core/src/config/types.ts` 定义了 `LLMProvider` / `EmbeddingProvider` 接口，容器里 `getLLM()` / `getEmbedding()` 是 **fail-fast stub**，永远抛错；`vectorStoreFactories` 只注册了 `memory`。
- 产品代码实际走 `@apigent/server/ai` 的 `createAIModel()`（AI SDK + `@ai-sdk/openai-compatible`），业务上下文生成与 agent 运行时都用它。
- `createAIModel()` **只提供 chat 语言模型**，没有任何 embedding 能力（AI SDK 的 `embed` / `embedMany` 是另一套 API，需要 `EmbeddingModel` 实例）。

也就是说：RAG 需要的 LLM（改写/生成）走哪条路、需要的 embedding 从哪来，现在**都没有答案**。若直接开写，等于在两条互不相通的抽象之间再插一套。

**需要决策：**

| 选项                             | 说明                                                                                                                      | 评价                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1. RAG 依赖 `@apigent/server/ai` | 新增 `createEmbeddingModel()`                                                                                             | 最快，但 `rag → server` 反向依赖，包不可独立复用，与「封装为 npm 包」目标冲突 |
| 2. 抽出 `@apigent/ai`（推荐）    | `createLanguageModel(flow)` / `createEmbeddingModel()` / `createRerankClient()`；`@apigent/server/ai` 变 re-export 保兼容 | 依赖方向干净，rag 与 server 都可独立使用                                      |
| 3. 保留容器接口                  | 为每个 provider 同时写「AI SDK 适配」+「容器接口适配」                                                                    | 两套适配必然漂移，`getLLM()` 变成死代码就是这么来的                           |

**推荐选项 2，并顺带决策端口类型：直接用 AI SDK 的 `LanguageModel` / `EmbeddingModel` 作为端口，删除自定义的 `LLMProvider` / `EmbeddingProvider`。** AI SDK 已是事实标准、provider 生态齐全、自带 telemetry middleware；自定义接口只会带来双份适配成本。

**顺带确认：** `LLMFlow` 已预留 `query_rewrite` / `rag_answer`，可直接使用。但 **reranker 不适用 `LLMFlow`**——`qwen3-rerank` 是独立的 rerank API，不是 chat completion，需要单独的客户端（§9 F3）。

#### A2 (P0) — Embedding 维度与「模型身份」缺失，会产生静默的质量劣化

> ✅ **已定案（2026-09-22）**：**维度固定 1024**（provider 适配器负责请求 1024 维，如 OpenAI 传 `dimensions: 1024`）；`knowledge_chunks` 增加 `embedding_model` / `embedding_dim` / `embedding_updated_at`；一个部署同一时刻只有一个活跃 embedding 模型；检索按当前模型过滤，不匹配的行视为待重索引、不参与召回；换模型 = 全量重索引。移除 `rag.embedding.provider: claude`。
>
> 与 P0-3 的 `tokenizer_version` 合并进同一次迁移——两者都是「这行数据是用哪个模型 / 哪个版本产出的」。`knowledge_chunks` 当前 0 行，本迁移零成本。

**现状（证据）：**

- `packages/server/src/db/schema/knowledge.ts`：`embedding vector("embedding", { dimensions: 1024 })`，迁移里是 `vector(1024)` + HNSW + `vector_cosine_ops`。
- 表里**没有任何字段记录这条向量是哪个模型、哪个维度产生的**。

**风险：**

1. 换 1536 / 3072 维模型 → 列定义与索引都要改，大表上是重活；
2. 更隐蔽的：用新模型重索引后，**新旧向量混在同一张表里不可比**，检索结果静默变差，没有任何字段能识别和排查；
3. 配置里 `EmbeddingProviderType` 含 `claude`，但 **Anthropic 没有 embedding API** —— 这个取值要么删除，要么标注 not supported，否则用户配了就报错。

**提前处理（迁移，现在便宜）：**

1. 加 `embedding_model varchar` / `embedding_dim int` / `embedding_updated_at`（或 `embedding_generation`），检索时按当前模型过滤；
2. 约定「一个部署同一时刻只有一个活跃 embedding 模型」，写入时校验；换模型 = 全量重索引，需要一条显式的 `reindex` 指令与进度反馈；
3. 维度策略二选一并写进文档：**(a) 固定 1024**（要求 provider 输出 1024；Qwen / OpenAI 均支持 `dimensions` 参数或 Matryoshka 截断）或 **(b) 按维度分列**（`vector(1024)` + `vector(3072)`）。
   **推荐 (a) 固定 1024 + 强校验**——分列会让索引数与内存占用成倍增长，且无法为所有维度组合建索引。

#### A3 (P0) — 中文稀疏检索：现有 BM25 设计对中文基本失效

> ✅ **已由 spike 定案（2026-09-22）**，报告：[rag-spike-p0-3.md](../tech/rag-spike-p0-3.md)。
>
> **结论：采用「应用侧 jieba 分词（`cutForSearch`）+ 标识符归一化」，数据库侧保持零扩展。**
>
> - 表结构上新增 `search_text`（应用写入切好词的文本）+ `tokenizer_version`，`search_vector` 由 `search_text` 的 generated column 派生——分词在应用侧、tsvector 在 DB 侧确定性生成，同时保留纯 SQL 可调试性。
> - 目标镜像 `pgvector/pgvector:pg17` 实测不带 pg_bigm / zhparser / pg_jieba 源码，装 C 扩展要自建镜像并绑定 PG 大版本 → 排除。
> - 实测：jieba `cutForSearch` 与 bigram 中文命中同为 11/11，索引体积约为 bigram 的 0.71×；jieba 分词质量明显优于 ICU（`余额` / `发货单` / `优惠券` 切分正确）。
> - **必须用 `cutForSearch`**：默认 `cut` 把「发货单」切成单个词元，用户查「发货」命中为 0。
> - `searchStore.provider` 保留 `pg-fts-bigram` 作为零依赖逃生通道。
>
> 另一个实测发现比中文问题更严重：**path 被切成单个 `file` token，用户写 `orders refund` 而非 `POST /orders/{id}/refund` 时命中率 0%、空召回 100%**——所以「给 path 加权」这件事必须配合标识符归一化才成立，这部分与分词方案无关，无条件采纳。

**现状（证据）：**

- `docs/modules/semantic-search.agent.md` §2.2 的 BM25 方案用 `to_tsvector('english', …)` + `setweight(method/path/summary/content)`。
- PostgreSQL 内置分词器**不切分中文**：`to_tsvector('simple', '退款接口')` 产出的是整串 token，中文全文检索近乎失效。
- 而中文在本产品是一等公民：UI 双语、`knowledge_chunks.lang` 列、中英双 chunk 策略、查询改写里专门有「中文 → 英文检索词」的规则——这些存在本身就说明中文检索质量是核心诉求，不能指望「反正用户会用英文搜」。

**选项：**

| 方案                                          | 说明                                                                        | 代价                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| (a) dense 主导 + FTS 只服务标识符（推荐起点） | 中文语义召回全靠 embedding；FTS 只承担 method / path / operationId / 英文词 | 零新增扩展，托管 PG 也能用；中文关键词精确匹配弱                        |
| (b) `pg_bigm`                                 | bigram 索引，中日韩友好                                                     | 需 `CREATE EXTENSION pg_bigm`；`setweight` 权重设计要重写为 bigram 形态 |
| (c) `zhparser` / `pg_jieba`                   | 中文分词最准确                                                              | 需安装额外扩展 .so，托管 PG 常不可用，部署门槛高                        |

**连带影响（必须一起改）：**

- `rag.searchStore.provider` 现在只有 `pg-fts` 一个取值，应扩为 `pg-fts-jieba`（默认）/ `pg-fts-bigram`（备选，零依赖逃生通道）/ `pg-fts-simple` / `none`，否则用户无从选择；
- `setweight` 的字段权重设计要按「只给标识符加权」重写（现在的 A/A/B/C 权重隐含了「正文可被英文分词命中」的前提）；
- **文档与实现不一致需一并修正**：设计文档称 `tsvector` 是 generated column「自动同步、不存在窗口期」，但实际迁移里 `search_vector` 是**普通列**（drizzle 的 `customType` 无法表达 `GENERATED ALWAYS AS … STORED`），必须由写入路径或触发器填充。
  注意一个具体的坑：`to_tsvector(text)` 的重载是 STABLE，**不能**用于 generated column；必须写成 `to_tsvector('simple'::regconfig, …)`。

### B. 索引与版本化策略

#### B1 (P0) — 索引「哪个版本」没有定义，表会单调增长

> ✅ **已定案（2026-09-22）：chunk 改为内容寻址 + `knowledge_chunk_links` 关联 commit；V0 索引主版本 HEAD。**
>
> 版本模型已演化为「主版本 / 非主版本」：**「当前版本」= `versions.is_default` 的 `head_commit_id`**，活跃单位是 **commit**。
>
> - `knowledge_chunks` 去掉 `version_id`，`chunk_key` 去掉 version 前缀，唯一键改为 **`(repository_id, chunk_key, content_hash)`**；
> - 新增 **`knowledge_chunk_links(commit_id, chunk_id)`**，与 `version_entity_links` 同构；
> - 理由：`endpoints` 是版本无关的内容块，`version_entity_links` 已记录「哪个 commit 用哪个 blob」。chunk 挂 `version_id` 等于在一个已做内容寻址的系统里按 commit 复制。
> - 换来：回滚 / 切主分支**零重索引**；存储只随去重后的内容量增长；与仓库自身的 blob + link 设计一致。
>
> **两条权限不变量（必须守住）：** ① chunk 身份含 `repository_id`，绝不做跨仓库内容共享；② 权限过滤打在 chunk 上、版本过滤打在 link 上，两层 AND、同一 SQL、`LIMIT` 之前——仍是检索前过滤，不退化为后过滤。

`knowledge_chunks` 有 `version_id`，且注释里 `chunk_key` 形如 `{version}:{level}:{method}:{path}:{lang}`。若每次导入/提交都索引，**历史版本与活跃版本会共存**：检索必须过滤活跃版本，否则返回重复或过期结果；不过滤则表随版本历史线性增长。

**需要定：**

1. 索引范围 —— **推荐只索引每个仓库的活跃版本**；历史版本不建检索索引（历史页浏览走 `version_entity_links`，不需要语义检索）；
2. 失效规则 —— 版本回滚 / 分支切换 / commit 被清理时，对应 chunks 何时删除或标记失效。**没有这条规则，表只会涨。**

#### B2 (P1) — 删除路径：仓库级已覆盖，接口级未覆盖

**好消息：** `apps/platform/src/services/repo-deletion.ts` 已按外键顺序先删 `knowledge_chunks`，仓库删除不会因这张表而失败。

**P0-4 定案后需追加一步：** 新增的 `knowledge_chunk_links` 必须排在 `knowledge_chunks` **之前**删除（该文件头的依赖顺序注释明确要求「顺序依据实际外键图，勿随意调整」），否则外键会挡住仓库删除。

**缺口：** 接口级删除不删行（它产生新 commit，旧 blob 复用），所以被删除接口的 chunks 会残留。这必须靠 §5 的**对账式同步**解决；因此 `chunk_key` 的构成要保证「同一逻辑单元在不同版本间稳定」，同时又能被期望集合精确算出补集。

> 这一点值得单独强调：**残留 chunk 不是性能问题，而是内容泄漏**——已经下线的接口仍可能被 agent 检索到并写进代码。

#### B3 (P1) — 摄取触发点与任务幂等

`repository_tasks.task_type` 的注释里已经预留了 `vectorize`，形态就是照抄 `context_tasks`。需要提前确认的触发点：

1. 导入成功 / 版本激活后；
2. 业务上下文生成或人工编辑后（上下文是 endpoint chunk 的语义主体，变了必须重索引该接口）；
3. 版本回滚后。

**不要在这些写入点直接 `await` 索引**——会让保存变慢，且索引失败会污染主事务。投递 `vectorize` 任务，复用 PgQueue + `repository_tasks` + 通知。

**需要一并处理：** 连续导入时不要排队跑多轮全量索引。参考 `contexts/service.ts` 现有的任务复用（reuse）策略，给索引任务做同样的去重（同一 `(repo, version)` 只允许一个进行中的任务）。

### C. 包边界与注册机制

#### C1 (P0) — 容器的注册 API 是 queue 专用的，必须通用化

**现状：** `Container` 只有 `registerQueueFactory(name, factory)` 一个注册口；`getVectorStore()` 的注册表里只有 `memory`；`getEmbedding()` **根本没有注册表**，直接抛错。

**后果：** 要让 `@apigent/rag` 的 pgvector / embedding 实现能被装上，就得改 `packages/core` 的源码——这与容器注释里「adding a real implementation is a one-line registration」的承诺矛盾，也不满足「整体/局部替换」。

**提前处理：** 加通用的注册 API（`registerVectorStoreFactory` / `registerEmbeddingFactory`，或统一为 `registerProvider(component, name, factory)`）。这是**纯重构、零行为变化**，建议在 RAG 开工前先做掉。否则 RAG 适配器会绕过容器直连 DB，容器就彻底沦为摆设。

#### C2 (P1) — 依赖方向不能成环（见 §2.3）

`@apigent/server` 会依赖 `@apigent/rag`（注册适配器、暴露 API），因此 `@apigent/rag` **绝不能** import `@apigent/server`。DB 句柄靠构造注入，绑定与注册放在 `packages/server/src/rag/index.ts`。建议加 lint 规则固定这条约束。

#### C3 (P1) — 客户端边界要在 exports 里表达出来

见 §2.4。客户端只能 import `@apigent/rag/contracts` 与 `@apigent/rag/tools`。顶层不要为了「方便」再导出一份纯类型——那会诱使客户端 import 顶层，进而在 `next build` 时报 `Can't resolve 'fs'`。

#### C4 (P1) — `apps/open` 目前不依赖 `@apigent/server`

MCP 挂载需要 DB + authz + keys。两条路：给 `apps/open` 加依赖（进程内直连），或让网关调平台 REST。V0 建议**进程内直连**（与「没有独立服务」的定位一致），但要先确认网关的启动路径：

- `loadConfig()` 以 `process.cwd()` 为起点向上找 `apigent.config.yaml` 与 `.env`——从 `apps/open` 启动时能否命中（`findUp` 逻辑上可以，但值得写一个 smoke 测试固化，避免将来改了 cwd 才炸）；
- 网关进程是否要跑 worker（队列消费者）；如果要，`startContextWorker()` 这类懒加载单例在长驻进程里的启动时机要明确。

#### C5 (P1) — MCP 形态的 RAG 被 SecretKey 校验阻塞，不要让它拖住检索

`verifySecretKey()` 尚未实现（且需拒绝 owner 被禁用/删除的 key）。RAG 本身不依赖它，但**MCP 形态的 RAG 依赖它**。

**建议顺序：** RAG 先上平台页面与 agent 运行时（session 鉴权，无前置依赖），MCP 暴露等 key 校验就位后再开。别把检索能力卡在 MCP 上。

### D. 可观测性与评估的「未就绪」项

#### D1 (P0) — `observability` 有枚举无实现，RAG 不得直连 OTel

> ✅ **命名已统一（2026-09-22，P1-4）**：以 `otlp` 为准（见 P1-4 定案），[rag-observability.md](./rag-observability.md) 里的 `otel` 已更正。代码侧本来就统一是 `otlp`，因此本次是纯文档修正、无行为变化。

`observability.provider: none | otlp | langfuse | phoenix` 四条路径都没有实现，OTel 依赖未安装。

**处理：** RAG 走 `RagTelemetry` 端口 + `LoggerTelemetry`（§7），上线即可观测；同时把枚举命名统一（`otlp` vs `otel`），否则将来写适配器要兼容两个名字。

#### D2 (P0) — traceId 要与现有日志上下文同源

`packages/server/src/logging` 已有 `LoggingContext`（`reqId` / `taskId` / `userId` / `organizationId` / `repositoryId`）贯穿 AsyncLocalStorage。RAG root span 的 `traceId` 应与它同源，否则一个请求会有两套关联 ID。

**处理：** 在 `LoggingContext` 加 `traceId`，RAG 入口写入，OTel adapter 读取。改动很小，但越晚越难插入（等各处都散落着 `reqId` 的读取点之后）。

#### D3 (P1) — 改写缓存没有载体，小心有人因此引入 Redis

配置有 `rag.queryRewriteCacheTtl: 3600`，但**没有 `CacheProvider` 接口或实现**，而 Redis 明确不在 V0 选型里（队列走 Postgres）。

**处理：** V0 用**进程内 LRU** 实现 `RagCache` 端口（多实例不一致可接受——改写只影响召回质量，不影响正确性），接口留出未来替换。不定的话，很容易有人为了一个缓存把 Redis 拖进 V0，破坏既有技术选型。

#### D4 (P1) — 评测需要冻结的索引快照，现在就要决定 fixture 从哪来

见 §8.3。若等评测写完再决定数据来源，会发现无法进 CI。

#### D5 (P1) — 确定性测试替身要随管线一起设计

`@apigent/rag/testing` 的 `hashEmbedder` / `memoryIndex` 不只是测试工具，它反过来约束了管线设计：**所有阶段必须靠注入组装**。这条约束成立与否，取决于第一版 pipeline 的写法，事后补代价很大。

### E. 产品与 UI 面

#### E1 (P1) — 平台侧目前没有任何搜索入口

`apps/platform/src/app/(authed)` 下没有 search 路由或组件。需要新增 API route（如 `/api/search`）+ 页面/顶栏入口，并在 `apps/platform/i18n/messages/{zh,en}` 补文案。

#### E2 (P1) — 结果展示依赖的字段必须进契约

`matchReason` / `highlights` / `degraded` / `trace`（§4.2）。这是为了「一屏一任务、先看后点」的交互要求，也是为了「零结果不沉默」——检索不到时要告诉用户为什么。

#### E3 (P2) — `repo:manage_mcp` 开关形态仍未定

它不是 RAG 的依赖，而是 MCP 的依赖（见 mcp-gateway.md 的「暴露粒度」）。排期上应在 MCP 之前，不要与 RAG 混在一起做。

### F. 低成本但容易忘的

| 编号    | 事项                    | 说明                                                                                                                                              |
| ------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 (P1) | pgvector 扩展需要权限   | 迁移里的 `CREATE EXTENSION IF NOT EXISTS vector` 在部分托管 PG 上需要超级用户；作为部署前置条件写进文档                                           |
| F2 (P1) | 摄取阶段要统计 token 数 | `rag.cost_per_query` 需要 token；建议进 `metadata`（或加列）。现在表里只有 `content_hash`，没有 token                                             |
| F3 (P1) | rerank 是独立 API       | `qwen3-rerank` 走 DashScope 的 rerank 接口，不是 chat completion，需要单独客户端；不要塞进 `createAIModel`                                        |
| F4 (P1) | 新增配置槽要改 4 处     | `ApigentConfigSchema` 全 `.strict()`，新增字段必须同步 `types.ts` + `schema.ts` + `defaults.ts` + `apigent.config.example.yaml`，漏一处启动即报错 |
| F5 (P2) | chunk 层级枚举有两份    | `rag.chunkStrategy`（`hierarchical`/`fixed`）与 `knowledge_chunks.level`（6 值）没有共享常量，容易漂移；建议收到 contracts 里统一                 |

---

## 10. 建议的实施顺序

> 本节只给阶段划分与先后关系。**可执行的任务清单（含验收标准、依赖、勾选状态）在 [rag-package-tasks.md](./rag-package-tasks.md)**，实际开发以那份为准。

### M0 — 前置整备（不含 RAG 功能，纯清理与决策）

1. 收敛 LLM/Embedding 出口（A1）；
2. 容器通用注册 API（C1）；
3. embedding 模型身份字段迁移（A2）；
4. `LoggingContext` 加 `traceId`（D2）；
5. 三项决策落地：中文稀疏检索方案（A3）、索引版本策略（B1）、维度策略（A2）。

### M1 — 包骨架与契约

6. `packages/rag` 目录 + `contracts` + `createRagService()` + `testing` 替身（D5）；
7. `RagTelemetry` 端口 + `LoggerTelemetry`（D1）；
8. 用 memory 适配器打通「摄取 → 检索」全链路，端到端单测（无 DB、无网络）。

> M1 结束时的验收：一条命令能跑通「写入若干 chunk → 中文查询 → 返回排序结果 + trace + 降级标记」，全程零外部依赖。

### M2 — 摄取（写路径）

9. `pg-document-source`（endpoints + business_contexts）；
10. chunker（hierarchical）；
11. embedding provider（qwen 起步）+ pgvector 稠密索引；
12. 对账式同步 + `vectorize` 任务接入（导入 / 上下文保存 / 版本激活）+ 任务复用（B3）；
13. 稀疏索引（按 A3 决策）。

### M3 — 检索（读路径）

14. dense + sparse 召回 + RRF + rerank + 上下文扩展；
15. `resolveSearchScope()`（C/§6.2）+ 平台 API route `/api/search`；
16. 平台搜索 UI + i18n（E1/E2）；
17. 查询改写（规则先行，LLM 后置）+ 缓存决策（D3）。

### M3.5 — 平台内助手先用同一套工具

18. `@apigent/rag/tools` 的 `search_apis` 注册进 `AgentToolRegistry`，助手上线。**这一步就能验证工具定义的正确性，且不被 MCP 阻塞**（C5）。

### M4 — 评估与可观测闭环

19. golden set fixture + seed 脚本（D4）；
20. `pnpm rag:eval` + 检索指标 + 阈值门禁；
21. LLM-judge（可选）；
22. OTel adapter（等 observability 阶段 C）。

### M5 — MCP 暴露

23. MCP Gateway + `verifySecretKey()` + `repo:manage_mcp` 开关。

---

## 11. 待确认的开放问题

1. **整体替换的粒度**：客户是真要替换「整条管线」（L0），还是只需要替换检索后端（L1/L2）？前者要额外设计 `RagService` 的完整契约与文档，成本明显更高。
2. **V0 是否要问答（answer generation）**，还是仅检索？这决定要不要 `AnswerGenerator`、要不要 LLM-judge 评测。
3. **中文稀疏检索选哪条路**（A3a/b/c）？需要确认目标部署环境能否安装 `pg_bigm` 等扩展。
4. **是否接受「V0 只索引活跃版本」**（B1）？
5. **是否需要跨组织全局检索**？影响 scope 形状与 `organization_id` 冗余列的用法。
6. **评测集由谁标注、规模多少**（PRD §8 亦列为未决项）。
7. **embedding 维度固定为 1024** 是否接受？

---

## 12. 配置变更清单（相对当前 `rag.*`）

> `ApigentConfigSchema` 是 `.strict()` 的，下列每一项都要同步改 4 处（types / schema / defaults / example yaml），见 F4。

| 变更                                       | 位置               | 说明                                                                                                     |
| ------------------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------- |
| 新增 `rag.provider`                        | `rag.*` 顶层       | L0 整体替换开关。按 P0-6 定案，**任何 `provider` 字段都接受「内置枚举值 \| npm 包名」**                  |
| 扩 `rag.searchStore.provider`              | `rag.searchStore`  | 由单一 `pg-fts` 扩为 `pg-fts-jieba`（默认）\| `pg-fts-bigram` \| `pg-fts-simple` \| `none`（A3，已定案） |
| 新增 `rag.telemetry.*`                     | `rag.telemetry`    | `recordQueryText` 等；导出后端仍走 `observability.*`（§7）                                               |
| 新增 `rag.cache.*`                         | `rag.cache`        | `provider: none \| memory-lru`、`ttl`（D3）                                                              |
| 新增 `rag.eval.thresholds`                 | `rag.eval`         | hit@3 / MRR / P95 / empty_rate 阈值（§8.2）                                                              |
| 调整 `rag.vectorStore.indexType`           | `rag.vectorStore`  | 删掉或明确标注「DDL 期决策、YAML 改了不生效」——当前 YAML 写 `ivfflat`，迁移实际建的是 HNSW，两者不一致   |
| 删除/标注 `rag.embedding.provider: claude` | `rag.embedding`    | Anthropic 无 embedding API（A2）                                                                         |
| 新增 `embedding_model` 等列                | `knowledge_chunks` | 表结构迁移，非配置（A2）                                                                                 |

---

## 13. 一句话总结

把 RAG 做成 `@apigent/rag`：**契约在包内、权限在包外、后端靠注册、观测靠端口、评测走同一条管线**。四个消费端点（平台页面 / agent 工具 / MCP / 评测）只是同一 `RagService` 的四个薄适配器。

动手之前必须先清掉三块地基：**LLM/Embedding 双轨制（A1）、embedding 模型身份缺失（A2）、中文稀疏检索失效（A3）**。这三项现在改是迁移与重构，等到检索写完再改，就是数据、索引、SQL 一起返工。
