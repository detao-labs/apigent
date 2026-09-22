# RAG Package — 分阶段开发任务清单

> **性质：** 工作清单（会随开发推进持续勾选与调整），不是架构文档。架构与取舍理由见 [rag-package.md](./rag-package.md)。
> **基线：** 2026-09-22
> **推进方式：** 一次只做**一个任务**；完成后勾选 `[x]`、写一行结论（实际做法与预设不符时同条记录），再进入下一个。

---

## 0. 推进规则

1. **按阶段顺序推进，不跳阶段。** 阶段之间有真实依赖（见各阶段「准入条件」）。
2. **Phase 0 的决策是闸门。** 决策未定就写代码，等于把返工写进排期。
3. **每个任务有独立验收标准。** 验收不通过就不勾选，不允许「先欠着」。
4. **任务粒度按「一次会话能做完并验证」划分。** 太大就拆，拆不动说明依赖没理清。
5. **配置类改动一律四处同步**：`types.ts` + `schema.ts` + `defaults.ts` + `apigent.config.example.yaml`（schema 是 `.strict()`，漏一处启动即报错）。

### 已具备的资产（不要重复造）

| 资产             | 位置                                                           | 状态                                    |
| ---------------- | -------------------------------------------------------------- | --------------------------------------- |
| RAG 配置槽       | `packages/core/src/config/types.ts`（`RAGConfig`）             | 已定义，读取方未实现                    |
| 配置校验         | `packages/core/src/config/schema.ts`                           | 已定义                                  |
| 默认值           | `packages/core/src/config/defaults.ts`（`DEFAULT_RAG_CONFIG`） | 已定义                                  |
| 检索单元表       | `packages/server/src/db/schema/knowledge.ts` + 迁移 `0000`     | 已建表（含 pgvector / tsvector / HNSW） |
| 内存向量库       | `packages/core/src/di/providers/memory-vector-store.ts`        | 可用于 dev/测试                         |
| 向量库接口       | `packages/core/src/types/vector-store.ts`                      | 已定义（仅稠密）                        |
| 队列 + 任务表    | `packages/server/src/queue`、`repository_tasks`                | `task_type` 已预留 `vectorize`          |
| 权限函数         | `packages/server/src/authz`（`listAccessibleRepositoryIds`）   | 已实现                                  |
| 日志上下文       | `packages/server/src/logging`（reqId / taskId / ALS）          | 已实现（缺 traceId）                    |
| Agent 工具注册表 | `packages/core/src/agent`                                      | 已实现（定义与执行器分离）              |

---

## Phase 0 — 决策冻结（闸门）

**目标：** 把六个会影响代码结构的决策定下来并留档。
**准入：** 无，最先做。
**退出条件：** 六项决策均有结论并写入「决策记录」；每项都能回答「不这么定会怎样」。

本阶段不写实现代码。产出是「决策记录」里的六行结论，需要时同步修改设计文档。

- [x] **P0-1 冻结 LLM / Embedding 出口方案** → **定案：模型调用能力放 `@apigent/core/ai`（工厂模式），RAG 专属的 embedding / rerank 放 `@apigent/rag`**
  - 背景：`getLLM()` / `getEmbedding()` 是 fail-fast 死代码；产品代码走 `@apigent/server/ai#createAIModel()`，而它没有 embedding 能力。
  - **定案细则：按「谁需要」切分，不按「是不是 AI」切分。**
    - **`@apigent/core/ai` = 「调用模型服务的能力」**（工厂模式，任何模块都能用）：
      `createLanguageModel(flow)` + 通用 provider 传输层（baseURL / apiKey 解析，OpenAI 兼容）。
    - **`@apigent/rag` = 「只有 RAG 需要的东西」**：embedding 模型工厂、rerank 客户端（`qwen3-rerank` 是独立 API，不是 chat completion）、分词器、管线与适配器。
    - **端口类型直接用 AI SDK 的 `LanguageModel` / `EmbeddingModel`**，删除自定义的 `LLMProvider` / `EmbeddingProvider` 与容器里那两个死 stub（否则每个 provider 要写两套适配，这正是 `getLLM()` 变成死代码的原因）。
    - `@apigent/server/ai` 保留为 re-export，现有调用点零改动。
    - 依赖方向：`@apigent/rag` → `@apigent/core`（`/config` + `/ai`）；`@apigent/server` → 两者（负责 wiring）。无环。
    - rag 的适配器接收**注入的选项**（apiKey / baseUrl / model），不自己读全局配置。
  - 阻塞：P1-1、P4-3。

- [x] **P0-2 冻结 embedding 维度与模型身份策略** → **定案：维度固定 1024 + 记录生产者身份 + 一个部署只有一个活跃模型**
  - **维度固定 1024。** provider 适配器负责请求 1024 维（如 OpenAI 传 `dimensions: 1024`，走 Matryoshka 截断）；写入时强校验向量长度。
    - 为什么可行：主要候选都支持 1024 —— Qwen `text-embedding-v4`（原生 1024）、Cohere v3（1024）、BGE-M3（1024）、OpenAI `text-embedding-3-*`（`dimensions` 参数）。
    - 为什么不按维度分列：索引数、内存、查询路径都要翻倍，且无法为所有维度组合建索引。
  - **记录生产者身份**：`knowledge_chunks` 增加 `embedding_model`（形如 `qwen:text-embedding-v4`）/ `embedding_dim` / `embedding_updated_at`。
  - **一个部署同一时刻只有一个活跃 embedding 模型**，配置层校验。
  - **检索按当前模型过滤**：`WHERE embedding_model = $current`；不匹配的行视为待重索引，不参与召回（避免新旧向量混表导致静默劣化）。
  - **换模型 = 全量重索引**，需要显式 `reindex` 指令与进度反馈。
  - **移除 `rag.embedding.provider: claude`**（Anthropic 无 embedding API）。
  - 时机红利：`knowledge_chunks` 当前 **0 行**，本次迁移零成本、无需回填。
  - 与 P0-3 的耦合：`embedding_model` 与 `tokenizer_version` 是同一类「生产者身份」字段，放同一次迁移（P3-1）。
  - 阻塞：P3-1。

- [x] **P0-3 冻结中文稀疏检索方案** → **定案：E（应用侧 jieba 分词），bigram 保留为备选 provider**
  - 背景：PostgreSQL 没有内置中文分词——默认 parser 把连续的 CJK 字符当作**单个 `word` token**，所以 `to_tsvector` 对中文近乎失效。设计文档里写的 `to_tsvector('english', …)` 同样是错的（english 配置不会切中文）。
  - 四种候选：
    - **A. `pg-fts-simple`** —— FTS 只服务标识符（method / path / operationId / 英文词），中文语义召回完全交给 dense。零扩展。代价：中文关键词精确匹配弱。
    - **B. SQL bigram** —— 用 IMMUTABLE 的 SQL 函数把 CJK 文本转成空格分隔的 2-gram，再喂 `to_tsvector('simple', …)`；查询侧做同一变换。零扩展，中文可用；代价是索引更大（token 数约翻倍）、有少量噪音匹配。函数名要带版本后缀（如 `cjk_bigram_v1`），改函数必须重建索引。
    - **C. `pg_bigm`** —— bigram 索引，无词典，中日韩行为可预测。需装扩展。
    - **D. `pg_jieba`（cppjieba）或 `zhparser`（SCWS）** —— 真正的分词 parser，精度最好。需装扩展；且与 PG 大版本绑定（每次升级 PG 要重编译）、词典维护与变更需 `REINDEX`；托管 PG 大多没有（Supabase / Neon 之类没有，部分云厂商 RDS 提供 zhparser，需按目标版本与地域确认）。
  - 已确认的技术点：`to_tsvector(regconfig, text)` 是 **IMMUTABLE**，可用于表达式索引或 generated column；一参形式 `to_tsvector(text)` 依赖 `default_text_search_config` GUC，是 **STABLE**，不能用于 generated column。
  - 关于 D 的判断：技术可行且最准，但 Apigent 是**开源自托管**产品（tech-design §5.5.1），把 C 扩展塞进数据库服务器会显著抬高自托管门槛，不适合作为 V0 的唯一路径；D 更适合定位为「客户环境允许时的可选增强」。
  - 建议：**先做 spike 再定，不要纸面推理定。** 用 10–20 条手写中文查询，对 A / B / D 对比 hit@k、索引体积、写入耗时；正式 golden set 到 Phase 7 再补齐。
  - 连带确定：`rag.searchStore.provider` 的枚举取值。
  - **spike 报告：[rag-spike-p0-3.md](../tech/rag-spike-p0-3.md)**（含六候选对照、扩展成本实测、jieba 实测于附录 A）。
  - **定案（2026-09-22）：采用 E —— 应用侧 jieba 分词 + 标识符归一化，数据库侧保持零扩展。**
    - 目标库 `pgvector/pgvector:pg17` 实测：只有 `vector` / `pg_trgm` / `unaccent`，**没有 pg_bigm / zhparser / pg_jieba 源码**，C / D 需自建镜像并承担 PG 大版本绑定的成本 → 排除。
    - **D 被否掉的理由（要往数据库服务器装 C 扩展）在 E 里不成立**：jieba 跑在 Node 进程，用户不需要装任何数据库扩展、也不需要编译任何东西。
    - 实测分词质量：jieba 明显优于 ICU（`余额` / `发货单` / `优惠券` 这些 ICU 会过切的领域词，jieba 切分正确）。
    - 实测检索指标：jieba `cutForSearch` 与 bigram 同为 11/11 中文命中；索引体积约为 bigram 的 0.71×（省约 30%）。
    - **必须用 `cutForSearch` 而非默认 `cut`**：默认 `cut` 把「发货单」切成单个词元，用户查「发货」命中为 0（实测 10/11）。这是本方案最容易踩的坑。
    - 标识符归一化（现状在「松散标识符」上 0% 命中 / 100% 空召回）是 B / E 共有部分，无条件采纳。
    - `searchStore.provider` 取值：`pg-fts-jieba`（默认）/ `pg-fts-bigram`（备选）/ `pg-fts-simple` / `none`。
    - 新增约束：索引必须记录 `tokenizer_version`（见 P3-1），版本不一致时拒绝检索或强制重索引。
  - 阻塞：P3-2、P3-3、P4-5。

- [x] **P0-4 冻结索引版本策略** → **定案：chunk 内容寻址 + `knowledge_chunk_links` 关联 commit；V0 索引主版本 HEAD**
  - **背景修正**：版本模型已演化为「主版本 / 非主版本」，**"当前版本" = `versions.is_default` 的 `head_commit_id`**（`repositories` 表注释已明确不再单列指针）。活跃单位是 **commit**，不是 version。
  - **为什么不按 commit 复制 chunk**：`endpoints` 是版本无关的内容块（blob），`version_entity_links` 记录「哪个 commit 用哪个 blob」，未变接口跨 commit 复用同一行。若 chunk 挂 `version_id`，等于在一个已做内容寻址的系统里按 commit 复制——50 个 commit 就是 50 份几乎相同的 chunk。
  - **定案细则：**
    1. `knowledge_chunks` **去掉 `version_id`**；`chunk_key` 去掉 version 前缀（变为 repo 内的逻辑身份，如 `{level}:{method}:{path}:{lang}`）；**唯一键改为 `(repository_id, chunk_key, content_hash)`**。
    2. 新增 **`knowledge_chunk_links(commit_id, chunk_id)`**，与 `version_entity_links` 同构，承担「哪个 commit 用哪些 chunk」。
    3. 索引范围：V0 = **每个仓库主版本（`is_default`）的 `head_commit_id`**；预留 `rag.indexedBranches: default | all`（`all` = 所有分支的 HEAD，可搜到进行中的版本）。
    4. 摄取 = 对账：算期望 `(commit → chunk_key, content_hash)` 集合 → upsert chunks → 更新 links → GC 无引用的 chunk 行。
  - **换来的三件事**：① 回滚 / 切主分支**零重索引**（只改 `head_commit_id`，chunk 都在）；② 存储只随「去重后的内容量」增长，不随版本数增长；③ 与仓库自己的 blob + link 设计一致。
  - **权限安全（必须守住的两条不变量，见下方 P3-4 验收）：**
    1. **chunk 身份必须包含 `repository_id`** —— 唯一键为 `(repository_id, chunk_key, content_hash)`，**绝不做跨仓库内容共享**。否则权限过滤的基准消失，只能靠 link 反推归属，漏写即成越权召回。
    2. **权限过滤与版本过滤是两层 AND，各打各的**：权限层 `WHERE c.repository_id = ANY($accessibleRepos)` 打在 chunk 上不变；版本层 `JOIN knowledge_chunk_links ON commit_id = $activeCommit` **只做收窄，不承担任何权限语义**。两者在同一 SQL、`ORDER BY … LIMIT` 之前 → **仍是检索前过滤**。
  - **衍生风险**：① link 与 chunk 必须同仓库（加测试钉住）；② `deleteRepository` 的清理顺序需在 `knowledge_chunks` **之前**插入 `knowledge_chunk_links`（该文件头的依赖顺序注释明确要求）；③ GC 无引用 chunk 时必须 `NOT EXISTS (select 1 from links …)`，防误删仍被其他 commit 引用的行。
  - 说明：**版本（分支）目前不是权限维度**（权限按仓库判定），所以收窄到某个 commit 不引入新的权限维度。
  - 时机红利：`knowledge_chunks` 当前 **0 行**，改主键与加表都是零成本。
  - 阻塞：P3-4、P4-6、P4-7。

- [x] **P0-5 冻结 V0 范围：是否包含问答生成** → **定案：不含。RAG 只返回检索结果，需要答案的一方自己生成**
  - **定案细则：**
    - `RagService` 接口只有 `index` / `retrieve` / `health` —— **没有 `answer`**。
    - 不做 `AnswerGenerator` 阶段，不做 `ask_apis` 工具。
    - 任务清单里 **P5-8、P7-5 已删除**。
    - `RetrieveResult` 契约里没有 answer 字段。
  - **附带好处**：评测可完全确定性（hit@k / MRR / 空召回率），能进 CI、可复现，不需要 LLM-as-judge。
  - 谁负责生成：平台助手 / MCP 客户端 / 外部 agent（Cursor、Claude）拿检索结果自行生成。
  - 阻塞：P2-3、P5-8、P7-5。

- [x] **P0-6 冻结整体替换粒度（L0 是否进 V0）** → **定案：`provider` 字段支持「内置枚举 | npm 包名」，改 YAML + 重启即可切换**
  - **统一规则：任何 `provider` 字段都接受两种取值 —— 内置枚举值，或 npm 包名。**
    ```yaml
    rag:
      embedding:
        provider: openai # 内置枚举
      retrieval:
        reranker:
          provider: "@acme/apigent-rerank-v2" # npm 包名（局部替换）
      provider: "@acme/apigent-rag-qdrant" # 整体替换（L0）
    ```
  - **用户流程**：`pnpm add <包>` → YAML 写包名 → 重启 → 生效。
  - **为什么写包名而不是文件路径**：文件路径会让配置文件变成任意代码执行入口（配置文件常被复制、被工单传递）。包名要求**该包必须已安装为依赖**，门槛与可审计性高得多，但「改一行配置 + 重启」的体验完全保留。
  - **启动期自检**（必做）：加载所有配置声明的 provider 并校验导出形状，不合格则**启动失败并给出可读错误**——同时给「重启后生效」一个明确的成功 / 失败信号。
  - **实现难点（三处，都可控）**：① 错误可读性（包不存在 / 导出形状不对 / 版本不兼容）；② 类型——第三方包把接口所在包声明为 **peerDependency**，避免多份副本；③ TS 类型在运行时不可见，需手写形状检查或 zod 校验导出。
  - **`apigent.config.ts` 保留为开发期逃生口**：本地文件路径 / 内联 factory。生产用 YAML 包名，开发用 config.ts。
  - 阻塞：P2-2、P2-6。

---

## Phase 1 — 基础重构（零行为变化）

**目标：** 清掉 RAG 会踩到的既有结构问题，且不改变任何对外行为。
**准入：** P0-1、P0-3 有结论。
**退出条件：** `pnpm -r typecheck && pnpm -r lint && pnpm -r test` 全绿，现有功能行为不变。

- [x] **P1-1 收敛 LLM / Embedding 统一出口**（按 P0-1 定案）
  - 改：
    1. `packages/core` 新增 `@apigent/core/ai`：`createLanguageModel(flow)` + 通用 provider 传输层（baseURL / apiKey 解析）。
    2. `@apigent/server/ai` 改为 re-export，现有调用点零改动。
    3. 删除容器里的 `getLLM()` / `getEmbedding()` 死 stub 与 `LLMProvider` / `EmbeddingProvider` 接口，端口统一用 AI SDK 的 `LanguageModel` / `EmbeddingModel`。
    4. **embedding 模型工厂与 rerank 客户端不放 core** —— 它们是 RAG 专属，放 `@apigent/rag`（P4-3 / P5-2）。
  - 验收：`createAIModel()` 的既有调用点行为不变；`@apigent/core/ai` 可独立于 rag 使用（不得 import rag 任何东西）；相关 fail-fast 测试同步更新。
  - **完成记录（2026-09-22）：**
    - 新增 `packages/core/src/ai/{index,model,transport}.ts`；`transport.ts` 是通用的「provider 选型 → OpenAI 兼容传输参数」纯函数层（`resolveLLMTransport` / `createOpenAICompatibleProvider`），RAG 后续复用它构造 embedding / rerank 客户端，但选项由 server 注入。
    - `packages/core/package.json` 新增 `./ai` subpath 与 `ai` / `@ai-sdk/openai-compatible` 依赖。**有意不进 core 根 barrel** —— 根 barrel 会被客户端组件引用，不能把 AI SDK 打进浏览器包。
    - 删除 `types/llm-provider.ts`、`types/embedding-provider.ts`、`di/providers/stub-{llm,embedding}.ts`，以及容器里的 `getLLM()` / `getEmbedding()` 和对应两个 fail-fast 测试。
    - 补了 `ai/transport.test.ts`（provider 映射 + fail-fast，7 例）与 `ai/model.test.ts`（flow → modelId 选择 + fail-fast，3 例）替代被删的覆盖。
    - `packages/server/src/ai/model.ts` 变为 re-export shim，同时导出 `createLanguageModel` 与旧名 `createAIModel`（现有调用点零改动）。调用点全部改名后 shim 可删。
    - 顺带修掉文档漂移：`CLAUDE.md` 四处、`docs/tech-design{,.zh}.md` 的「实现状态」与 §5.5 说明、`knowledge-retrieval.md` / `rag-observability.md` 各一处。
  - 验证：`tsc` 六个包全绿（core/server/auth/ui/platform/admin/open）；eslint 干净；测试 core 9 文件 45 例、server 12 文件 77 例、auth 4 例、open 2 例，全通过。
  - 风险：中（触及业务上下文生成与 agent 运行时）。

- [x] **P1-2 容器通用 provider 注册 API**
  - 目标：新增一个 vectorStore / embedding 实现不需要改 `packages/core` 源码。
  - 改：`packages/core/src/di/container.ts` —— 把 queue 专用注册口通用化（`registerVectorStoreFactory` / `registerEmbeddingFactory`，或 `registerProvider(component, name, factory)`）。
  - 验收：注册表为空时首次访问仍 fail-fast（沿用既有契约，不静默回退）；既有 `container.test.ts` 的 fail-fast 用例继续通过并覆盖新入口。
  - 风险：低（纯机械重构）。
  - **完成记录（2026-09-22）：**
    - 采用**按组件分型的三个方法**而非统一 `registerProvider(component, ...)`：`registerVectorStoreFactory` / `registerStorageFactory` / `registerQueueFactory`。统一入口需要一个工厂类型联合，反而丢掉「不能把 queue 工厂注册进向量库表」这层类型保护。
    - `ProviderFactory<T>` 改为导出，供 `packages/server` 声明注册函数。
    - 三条注册契约写进容器注释：① 未注册的 provider 首次访问 fail-fast；② 键就是 `provider` 字段取值；③ 同名重复注册以后注册者为准（内置先注册，故外部可覆盖内置）。
    - 补 6 个测试覆盖三个新入口、覆盖内置名、以及「枚举里有取值但 core 无内置实现」的场景（qdrant）。
  - ⚠️ **发现的缺口（属后续任务）**：P0-6 要求 `provider` 字段能**直接写 npm 包名**，但配置类型（`VectorStoreConfig` 等判别联合）仍只接受固定字面量，写包名会被 TS/zod 挡下。
    放宽配置类型会**改变失败时机**——写错 provider 名会从「配置校验期报错」退化成「运行期才报错」——所以必须与**启动期自检**同时落地，否则是行为退化。Phase 1 要求行为中性，故此处不放宽。已在测试里写明原因。

- [x] **P1-3 `LoggingContext` 增加 `traceId`**
  - 目标：日志与 trace 同源，避免一个请求两套关联 ID。
  - 改：`packages/server/src/logging/index.ts`。
  - 验收：请求上下文里能读到 `traceId`；由 `reqId` 兜底时不报错。
  - 风险：低。
  - **完成记录（2026-09-22）：** `LoggingContext` 增加 `traceId`；解析顺序为「显式传入 > 外层已有 > 兜底」——**请求兜底到 `reqId`，任务兜底到 `taskId`**。任务在请求内运行时保留外层 `traceId`（一次操作只有一条链路），`withRequestContext` 的 `extra` 仍可显式覆盖。补 4 个测试。
  - 待接线（P2-4）：`RagTelemetry` 的 logger adapter 需要读这个 `traceId`；因依赖方向约束（rag 不得 import server），adapter 应由 `packages/server` 提供并注入 rag，而不是 rag 自己去读日志上下文。

- [x] **P1-4 统一 observability provider 枚举命名**
  - 目标：消除 `otlp`（类型定义）与 `otel`（设计文档示例）的命名冲突。
  - 改：设计文档 + `types.ts` / `schema.ts` / 示例 YAML，任选其一作为准。
  - 验收：全文只有一种写法；配置校验接受该值。
  - 风险：低。
  - **完成记录（2026-09-22）：以 `otlp` 为准，且本次是纯文档修正、零代码改动。**
    - 理由：代码侧（`types.ts` / `schema.ts` / `apigent.config.example.yaml`）本来就统一用 `otlp`，连嵌套配置键都叫 `observability.otlp`；`otlp` 指具体的 OTLP 导出协议，而 `otel` 是生态名。取 `otlp` 意味着枚举值与嵌套键同名，选 `otel` 则要连嵌套键一起改。
    - 改动：`rag-observability.md`（表格 + 示例 YAML 的 `provider: otel` 与 `export.otel` → `otlp`），`rag-package.md` 一处枚举列表。`observability.md` 本来就写的是 `otlp`。

- [x] **P1-5 固化「新增配置槽 checklist」**
  - 目标：把四处同步的要求写进 CLAUDE.md 或脚本，避免漏改导致启动报错。
  - 验收：新同学按 checklist 能一次改对。
  - 风险：低。
  - **完成记录（2026-09-22）：** 写进 `CLAUDE.md` → Config Module Architecture → **Adding a new config slot — the four-place rule**。
    - 四处必改：`types.ts` / `schema.ts` / `defaults.ts` / `apigent.config.example.yaml`。
    - 两处按需：secret 类槽位要接 `file-loader.ts` 的 `injectSecrets()`；被消费的槽位要同步读取方。
    - 附了一句真实的踩坑案例（`rag.vectorStore.indexType` 四处齐全但**没有任何代码读它**，改 YAML 不生效），并提示改完用 `pnpm --filter @apigent/core test` 验证。

---

## Phase 2 — 包骨架与契约（无数据库）

**目标：** 用纯内存适配器打通「摄取 → 检索 → trace/降级」全链路，把契约钉死。
**准入：** P0-6 有结论；Phase 1 完成。
**退出条件：** 一条命令跑通「写入若干 chunk → 中文查询 → 返回排序结果 + trace + 降级标记」，全程零外部依赖（无 DB、无网络、无 API key）。

> 这一阶段刻意不碰数据库。契约由真实管线验证过之后再落表，能避免迁移两次。

- [ ] **P2-1 建 `packages/rag` 包骨架**
  - 交付：`package.json`（exports 按设计要求分层）、`tsconfig.json`、`vitest.config.mts`、空 barrel。
  - 验收：`pnpm --filter @apigent/rag typecheck` 通过。

- [ ] **P2-2 `contracts` 子模块**
  - 交付：`RetrieveRequest` / `RetrieveResult` / `RetrievedChunk` / `IndexRequest` / `IndexReport` / `RagScope` / `RagTraceSummary` / `RagDocument` / 错误类 / 枚举常量（chunk level 等）。
  - 约束：**零重依赖**（不得 import db / pg / drizzle），客户端可安全 import。
  - 验收：类型自洽；`RagScope.repositoryIds` 必填（不存在「不传 = 全库」的形态）。

- [ ] **P2-3 `tools` 子模块**
  - 交付：`search_apis` 工具定义（name / description / zod inputSchema），无执行器；按 P0-5 决定是否加 `ask_apis`。
  - 验收：只依赖 zod；不被 `@apigent/rag` 顶层 import。

- [ ] **P2-4 `RagTelemetry` 端口 + `LoggerTelemetry`**
  - 交付：端口接口 + noop + logger 实现（输出 `rag.query` / `rag.stage` / `rag.degraded` 结构化事件）。
  - 验收：RAG 源码中不存在 `@opentelemetry` import；telemetry 抛错不影响检索（fail-open）。

- [ ] **P2-5 `testing` 子模块（确定性替身）**
  - 交付：`hashEmbedder`、`memoryIndex`、`RecordingTelemetry`、fixture `ragDocumentSource`。
  - 验收：无网络、无 API key 即可跑完整检索链路。

- [ ] **P2-6 `pipeline` + `createRagService()`**
  - 交付：阶段注册表 + 编排；所有阶段靠注入组装，**管线内不得有隐藏全局单例**。
  - 验收：换掉任一阶段注入即可改变行为，无需改管线代码。

- [ ] **P2-7 端到端单测（含中文查询）**
  - 覆盖：正常召回、空召回降级、telemetry 记录、中文查询命中。
  - 验收：`pnpm --filter @apigent/rag test` 全绿。

- [ ] **P2-8 客户端边界与依赖方向约束**
  - 交付：lint 规则 —— `packages/rag/**` 禁止 import `@apigent/server*`；顶层 barrel 不导出纯类型便利入口（避免诱导客户端 import 顶层）。
  - 验收：故意写一句违规 import 会被 lint 拦住。

- [ ] **P2-9 中文分词器阶段（应用侧 jieba）** ← P0-3 定案产物
  - 交付：`Tokenizer` 阶段 + `@node-rs/jieba` 适配器。
    - 必须用 **`cutForSearch`**（搜索模式），**不得用默认 `cut`**：实测默认模式把「发货单」切成单个词元，用户查「发货」命中为 0。把这条写进代码注释与测试。
    - 同时输出**标识符归一化**结果（method / path / operationId → 小写 + 非字母数字转空格），供稀疏索引使用。
    - 暴露 `tokenizerVersion`（库版本 + 词典版本 + 分词模式），供 P3-1 写入索引元数据。
  - 约束：分词器实例是进程级单例（词典常驻内存），首次加载有开销；三个进程（平台 / worker / MCP 网关）各加载一次，要确认内存与冷启动可接受。
  - 可选增强：领域词典（退款 / 优惠券 / 库存 …）通过 `loadDict` 注入，词典内容与版本一并纳入 `tokenizerVersion`。
  - 验收：`余额` / `发货单` / `优惠券` 切分正确；「发货」能命中「发货单」；同输入重复调用结果稳定。

---

## Phase 3 — 数据模型与配置对齐（迁移）

**目标：** 让表结构与配置能承载 Phase 2 验证过的契约。
**准入：** P0-2 / P0-3 / P0-4 有结论；Phase 2 完成。
**退出条件：** 迁移可正向 / 回滚执行；`pnpm db:check` 与 schema 一致；配置校验通过。

> 时序要点：本阶段必须在**任何真实摄取写入之前**完成，但不必在 Phase 2 之前 —— 那时还没有数据要迁移。

- [ ] **P3-1 `knowledge_chunks` 增加「生产者身份」列**
  - 交付：一次迁移同时加两组字段。
    - **向量侧（P0-2 定案）**：`embedding_model`（形如 `qwen:text-embedding-v4`）/ `embedding_dim` / `embedding_updated_at` + 必要索引；检索按当前模型过滤，不匹配的行视为待重索引、不参与召回。
    - **文本侧（P0-3 定案）**：`tokenizer_version`，记录该行文本是哪个分词器版本 + 词典版本 + 分词模式产出的；检索时校验，不一致则拒绝检索或强制重索引。
  - 说明：两者本质是同一类问题——「这行数据是用哪个模型 / 哪个版本产出的」，合并一次迁移。
  - **时机红利**：`knowledge_chunks` 当前 **0 行**，本迁移零成本、无需回填。（spike 实测确认）
  - 验收：迁移命名可读（`pnpm db:generate -- --name=...`）；新旧模型向量混表的场景在类型 / SQL 层面被排除。

- [ ] **P3-2 修正 `search_vector` 形态**
  - 现状：设计文档称其为 generated column「自动同步、无窗口期」，实际是**普通列**；且 `to_tsvector(text)` 是 STABLE、不能用于 generated column。
  - P0-3 定案后的形态（推荐）：应用侧写入切好词的 **`search_text`** 列，`search_vector` 做成从它派生的 generated column：
    `GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, search_text)) STORED`
    这样分词在应用侧、tsvector 在 DB 侧确定性生成，且**保留纯 SQL 可调试性**（可以直接 `select search_text` 看到切成了什么）。
  - 验收：写入一条 chunk 后 `search_vector` 非空；`select search_text` 能看到 jieba 的切分结果；同步修正设计文档表述。
  - 部署注意（spike 实测）：`CREATE EXTENSION vector` 需要 superuser，而当前应用账号 `apigent` 恰好是 superuser；生产环境不应如此——**扩展安装必须是部署 / 迁移步骤，不是应用启动步骤**。写进部署前置条件。

- [ ] **P3-3 按 P0-3 决策调整 `rag.searchStore`**
  - 交付：枚举扩为 `pg-fts-jieba`（默认）/ `pg-fts-bigram`（备选）/ `pg-fts-simple` / `none`，四处同步。
  - 验收：配置非法值 fail-fast；选 `none` 时管线走 dense-only 不报错。
  - 为什么保留 bigram：它零依赖、无版本漂移，是 jieba 出问题时的逃生通道；而且实现只有一段 SQL（spike 已验证），保留成本极低。

- [ ] **P3-4 chunk 内容寻址改造 + `knowledge_chunk_links` 建表**（按 P0-4）
  - 交付（`knowledge_chunks` 是 0 行，本次改造零成本）：
    1. `knowledge_chunks` **去掉 `version_id`**；`chunk_key` 去掉 version 前缀；唯一键改为 **`(repository_id, chunk_key, content_hash)`**；保留 `repository_id` / `organization_id` 快照列不变。
    2. 新增 **`knowledge_chunk_links(commit_id, chunk_id)`**，主键 `(commit_id, chunk_id)`，索引 `(commit_id)`；外键指向 `version_commits` / `knowledge_chunks`。
    3. 新增查询所需索引：向量 HNSW、`search_vector` GIN 保持不变；补 `knowledge_chunks(repository_id, chunk_key)`。
  - **权限不变量（Phase 4 验收项，必须用测试钉住）：**
    - ① **chunk 身份含 `repository_id`** —— 跨仓库内容共享在结构上不可能。
    - ② **权限过滤打在 chunk 上、版本过滤打在 link 上，两层 AND、同一 SQL、`LIMIT` 之前** —— 不得退化为检索后过滤。
    - ③ link 的 `commit_id` 所属仓库必须等于 `chunk_id` 的 `repository_id`。
  - 集成注意：`apps/platform/src/services/repo-deletion.ts` 的清理顺序需在 `knowledge_chunks` **之前**插入 `knowledge_chunk_links`（该文件头的依赖顺序注释明确要求，勿随意调整）。
  - 验收：两个版本共存时默认检索只返回活跃 commit 的结果；回滚（改 `head_commit_id`）后**无需重索引**即可正确切换；越权用例（chunk 属于无权限仓库）在 SQL 层被排除。

- [ ] **P3-5 处理 `rag.embedding.provider: claude`**
  - 现状：Anthropic 无 embedding API，该取值跑不通。
  - 交付：删除，或保留但从 schema 层标注 not supported 并 fail-fast 给出可读错误。

- [ ] **P3-6 处理 `rag.vectorStore.indexType`**
  - 作用：选择 pgvector 的近似最近邻（ANN）索引算法。
    - `ivfflat` —— k-means 把向量聚成 `lists` 个倒排桶，查询时只探 `probes` 个最近的桶。**必须先有数据再建索引**（要训练质心），pgvector 官方明确建议先灌数据；参数 `lists`（经验值约为行数/1000）与查询期 `ivfflat.probes`。
    - `hnsw` —— 多层近邻图，查询沿图游走。无训练步骤、**空表即可建索引**、增量插入友好；参数 `m`(默认 16) / `ef_construction`(64) 与查询期 `hnsw.ef_search`(40)。代价是内存占用更高、建索引更慢。
  - 性质：它只影响「**性能 ↔ 召回率**」的权衡，不是功能开关——没有索引或数据量小时 pgvector 会退化成精确全表扫描，结果**更准**只是更慢。
  - 现状（已核实）：该字段只出现在配置类型 / schema / 默认值 / 三处测试中，**没有任何运行时代码读取它**；真实索引硬编码在 `packages/server/src/db/schema/knowledge.ts`（`using("hnsw", …)`），迁移里是 `USING hnsw ("embedding" vector_cosine_ops)`。也就是说 YAML 里写的 `ivfflat` 是纯装饰。
  - 结论：**迁移里选 HNSW 是对的，YAML 里的 `ivfflat` 才是错的**——迁移在空表上执行，IVFFlat 在空表上建会退化；而我们的摄取是增量写入 + 对账式删除，HNSW 对增量更友好。
  - 交付：从配置移除 `indexType`；调优参数（`m` / `ef_construction` / `ef_search`）与「何时 `REINDEX`」走运维 / DBA 文档，不进应用配置。
  - 连带：换 embedding 模型或维度必须重建该索引，与 P0-2 属同一类「DDL 期、不可运行时切换」的问题。同理，`vector_cosine_ops` 这个距离度量也是 DDL 期决策，换它会改变结果排序。
  - 运维提示：对账式删除会在 HNSW 图里留下大量死元组，长期会退化，需要定期 `REINDEX`（或按仓库分区缓解）。

---

## Phase 4 — 摄取（写路径）

**目标：** 把 API 知识变成可检索的索引，且删除能正确生效。
**准入：** Phase 3 完成。
**退出条件：** 导入一个样例后能检索到；删除一个接口后**检索不到**（回归用例固化）。

- [ ] **P4-1 `pg-document-source`**
  - 交付：从 `endpoints` + `endpoint_responses` + `business_contexts` + `components` 组装 `RagDocument[]`。
  - 约束：DB 句柄构造注入，**不 import `@apigent/server`**。
  - 验收：单测覆盖「有 / 无业务上下文」两种接口。

- [ ] **P4-2 chunker（`hierarchical`）**
  - 交付：L0 project / L1 tag / L2 endpoint / L3 schema+rules 分块；中英双 chunk。
  - 验收：`chunk_key` 稳定且能精确算出期望集合（对账的前提）；同输入重复跑结果幂等。

- [ ] **P4-3 embedding provider（qwen 起步）**
  - 交付：基于 P1-1 出口的 embedding 实现 + token 统计。
  - 验收：批量 embedding 有并发 / 批次控制；失败时给出明确错误而非静默截断。

- [ ] **P4-4 pgvector 稠密索引适配器**
  - 交付：`DenseIndex` 实现（写入 + 按 `scope` 过滤检索）。
  - 验收：过滤条件在 SQL 层生效（**不是**取回后再过滤）。

- [ ] **P4-5 稀疏索引适配器**（按 P0-3 决策）
  - 交付（`pg-fts-jieba`，默认）：
    1. 写入路径：`Tokenize(doc) → search_text → INSERT`，由 P3-2 的 generated column 产出 `search_vector`；
    2. 查询路径：**用同一个分词器实例、同一个 `cutForSearch` 模式**处理查询串，词元去重后以 **OR** 连接成 tsquery（用 AND 会几乎必然空召回），并过滤掉非 `[a-z0-9 CJK]` 的词元以免破坏 tsquery 语法；
    3. 标识符归一化结果一并写入 `search_text` 的标识符区段；
    4. 字段权重按新方案重设（原 `path` A 级权重对 `file` token 无效）。
  - 交付（`pg-fts-bigram`，备选）：纯 SQL 的 CJK 2-gram 函数，版本化命名（如 `cjk_bigram_v1`），文档侧与查询侧必须用同一个函数。
  - 验收：用同一套语料与查询集，`pg-fts-jieba` 与 `pg-fts-bigram` 均达到 92%+ hit@1 / 100% hit@3 / 0% 空召回；改写式查询不要求命中（那是 dense 的职责）。
  - 运维：分词器版本或词典变更、bigram 函数变更，都必须 `REINDEX` 并更新 `tokenizer_version`；写进实现注释与运维文档。

- [ ] **P4-6 对账式同步**
  - 交付：期望集合 diff → upsert 变更 → 删除同 `(repository, version)` 下不在集合内的行；`content_hash` 复用跳过未变项；token / 成本统计落库。
  - 验收：**删除接口后该 chunk 不再被任何检索路径召回**（单测固化）。

- [ ] **P4-7 `vectorize` 任务接入**
  - 交付：复用 PgQueue + `repository_tasks`；触发点 = 导入成功 / 版本激活 / 业务上下文保存；同一 `(repo, version)` 只允许一个进行中的任务（参考 `contexts/service.ts` 的复用策略）。
  - 验收：连续两次导入不会排队跑两轮全量索引；任务失败可重试且不污染业务事务。

- [ ] **P4-8 摄取端到端单测**
  - 覆盖：首次全量、增量、删除、版本切换、失败重试。
  - 验收：`pnpm --filter @apigent/rag test` 与 server 侧测试全绿。

---

## Phase 5 — 检索（读路径）

**目标：** 自然语言查询 → 排序结果，含权限过滤与降级。
**准入：** Phase 4 完成。
**退出条件：** 平台 API 能返回带 `match_reason` / `highlights` / `degraded` / `trace` 的结果。

- [ ] **P5-1 多路召回 + RRF 融合**
  - 交付：dense + sparse 并行召回，RRF 融合到 `coarseRankTopK`。
  - 验收：单路为空时仍能返回结果（不整体失败）。

- [ ] **P5-2 rerank 适配器**
  - 交付：`qwen3-rerank` 独立客户端（**不是** chat completion，不要塞进 `createAIModel`）；`none` / `cohere` / `bge-reranker` 按优先级跟进。
  - 验收：rerank 失败时降级到粗排结果并打 `degraded.reason`。

- [ ] **P5-3 上下文扩展**
  - 交付：按 `parent_id` / `level` 追加 tag 概述、业务规则、示例。
  - 验收：同一 tag 的多个命中共享一份 L1，不重复查询。

- [ ] **P5-4 `resolveSearchScope()`**
  - 交付：唯一的权限交集实现 —— `listAccessibleRepositoryIds(userId)` ∩ key 白名单（空 = 不限制）∩ repo / org / project 收窄；单仓库搜索先 `assertRepoAccess`。
  - 验收：四种调用方（平台 / agent / MCP / 评测）共用同一函数；无权限返回 403 而非空列表。

- [ ] **P5-5 查询改写：规则层**
  - 交付：**零成本规则判断**先行 —— 精确 method+path 不改写、短英文查询不改写、`fast` 模式不改写。
  - 验收：规则命中时不产生任何 LLM 调用。

- [ ] **P5-6 查询改写：LLM + 缓存**
  - 交付：LLM 改写 + `RagCache` 端口 + 进程内 LRU 实现（沿用 `queryRewriteCacheTtl`）。
  - 约束：**不引入 Redis**（会破坏 V0 技术选型）。
  - 验收：改写失败降级 `fast` 模式且打 `degraded` 标记。

- [ ] **P5-7 检索单测**
  - 覆盖：正常 / 空召回 / 单路失败 / rerank 失败 / 无权限 / 中英混合查询。
  - 验收：每条降级路径都有对应断言。

---

## Phase 6 — 平台接入

**目标：** 平台页面用上检索能力，且复用同一套工具定义。
**准入：** Phase 5 完成（P5-4 必需）。
**退出条件：** 平台搜索 UI 可用、中英文完整；助手抽屉能调用 `search_apis`。

- [ ] **P6-1 API route `POST /api/search`**
  - 交付：`apps/platform/src/app/api/search/route.ts`，`withRoute` 包装 + zod 校验入参 + `resolveSearchScope()`。
  - 验收：参数非法 400、无权限 403、正常返回契约结构。

- [ ] **P6-2 agent 工具执行器注册**
  - 交付：把 `@apigent/rag/tools` 的 `search_apis` 注册进 `AgentToolRegistry` + server 执行器。
  - 说明：这一步先于 MCP，能验证工具定义正确性，**且不被 MCP / SecretKey 阻塞**。

- [ ] **P6-3 平台搜索 UI**
  - 交付：顶栏入口或独立页 + 结果列表（method + path + capability intent + match reason + relevance）。
  - 验收：点击结果可直达接口详情页。

- [ ] **P6-4 i18n 中英文案**
  - 交付：`apps/platform/i18n/messages/{zh,en}` 新增搜索模块文案。
  - 验收：中英切换无缺漏 key。

- [ ] **P6-5 空状态与降级提示**
  - 交付：零结果、空召回降级、无权限三种状态的界面表现（沿用「零结果不沉默」的既定行为规范）。
  - 验收：降级时用户能看到原因，而不是只看到空列表。

---

## Phase 7 — 评估与可观测闭环

**目标：** 检索质量可度量、可回归、可对比。
**准入：** Phase 4 / 5 完成（需要真实索引与检索）。
**退出条件：** `pnpm rag:eval` 产出报告，指标可对比基线。

- [ ] **P7-1 golden set + seed 脚本**
  - 交付：`data/rag-eval/golden.json`（含 `datasetVersion`）+ seed 脚本把固定 OpenAPI 样例导入固定 repo id。
  - 验收：评测可冻结索引（内容变化时指标仍可比）；`data/` 未被 gitignore，可直接提交。

- [ ] **P7-2 检索指标计算**
  - 交付：hit@k / MRR / nDCG / 空召回率 / 降级率 / `unanswerable` 单独统计。
  - 约束：**必须走生产同一条 `createRagService()`**，只替换 scope / telemetry / cache。

- [ ] **P7-3 `pnpm rag:eval` CLI + 报告产物**
  - 交付：JSON + Markdown 报告；临时报告 gitignore，baseline 提交。
  - 验收：无 API key 环境下（用 P2-5 替身）排序指标仍可跑。

- [ ] **P7-4 阈值门禁**
  - 交付：阈值放配置（`rag.eval.thresholds`），不达标退出码非零；按需接 CI。
  - 验收：故意调低检索质量能让 eval 失败（验证门禁真的生效）。

- [ ] **P7-6 OTel adapter**（等 observability 阶段 C 就绪）
  - 交付：`RagTelemetry` 的 OTLP 实现。
  - 验收：检索代码零改动即接入（验证端口化的价值）。

---

## Phase 8 — MCP 暴露

**目标：** 外部 agent 通过 MCP 使用检索能力。
**准入：** Phase 6 完成；SecretKey 校验与 `repo:manage_mcp` 形态已定。
**退出条件：** MCP 客户端能 `initialize` → `tools/list` → `tools/call` 拿到带权限过滤的结果。

- [ ] **P8-1 实现 `verifySecretKey()`**
  - 交付：密钥校验，拒绝 owner 被禁用 / 删除的 key；`last_used_at` 与调用计数留痕。
  - 验收：吊销 / 禁用 / 删除三条路径均有测试。

- [ ] **P8-2 `repo:manage_mcp` 开关**
  - 前置：先定形态（仓库级布尔开关 + 连接信息卡片，见 [mcp-gateway.md](./mcp-gateway.md)）。
  - 验收：关掉的仓库不出现在 MCP 检索结果中。

- [ ] **P8-3 MCP Gateway 挂载**
  - 交付：`apps/open` 挂 `/mcp`（Streamable HTTP），复用 `@apigent/rag/tools` 定义；参数校验、超时、限流。
  - 验收：`tools/list` 与平台侧工具定义一致（单一来源）。

- [ ] **P8-4 `apps/open` 依赖与启动路径**
  - 交付：加 `@apigent/server` 依赖；确认从 `apps/open` 启动时 `loadConfig()` 能找到根 `apigent.config.yaml` 与 `.env`（`findUp` 逻辑上可以，但要用 smoke 测试固化）。
  - 验收：`pnpm --filter @apigent/open dev` 后 `/health` 与 `/mcp` 均可用。

- [ ] **P8-5 MCP scope 解析**
  - 交付：`scope = key owner 权限 ∩ key 仓库白名单 ∩ repo 开关`，复用 P5-4 的 `resolveSearchScope()`。

- [ ] **P8-6 MCP 调用留痕**
  - 交付：`mcp.call` 事件进 `operation_logs`（事件名现在加进 `OPERATION_TYPES` 很便宜）+ `last_used_at`。

---

## 进度看板

| 阶段                       | 任务数 | 已完成 | 状态    |
| -------------------------- | ------ | ------ | ------- |
| Phase 0 决策冻结           | 6      | 6      | ✅ 完成 |
| Phase 1 基础重构           | 5      | 5      | ✅ 完成 |
| Phase 2 包骨架与契约       | 9      | 0      | 未开始  |
| Phase 3 数据模型与配置对齐 | 6      | 0      | 未开始  |
| Phase 4 摄取               | 8      | 0      | 未开始  |
| Phase 5 检索               | 7      | 0      | 未开始  |
| Phase 6 平台接入           | 5      | 0      | 未开始  |
| Phase 7 评估与可观测       | 5      | 0      | 未开始  |
| Phase 8 MCP 暴露           | 6      | 0      | 未开始  |

**下一个任务：** P2-1 建 `packages/rag` 包骨架（Phase 1 已完成，进入 Phase 2）

---

## 决策记录

> Phase 0 的结论写在这里。每条包含：结论 / 理由 / 不这么定的代价。

| 编号 | 决策                     | 结论                                                                                                                                      | 日期       |
| ---- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| P0-1 | LLM / Embedding 出口     | **模型调用能力（工厂）放 `@apigent/core/ai`；RAG 专属的 embedding / rerank 放 `@apigent/rag`**；端口用 AI SDK 类型，删自定义接口与死 stub | 2026-09-22 |
| P0-2 | embedding 维度与模型身份 | **维度固定 1024 + 记录 `embedding_model` / `embedding_dim` / `embedding_updated_at` + 一个部署只有一个活跃模型**；换模型需全量重索引      | 2026-09-22 |
| P0-3 | 中文稀疏检索方案         | **E：应用侧 jieba 分词（`cutForSearch`）+ 标识符归一化，DB 零扩展**；bigram 保留为备选 provider                                           | 2026-09-22 |
| P0-4 | 索引版本策略             | **chunk 内容寻址 + `knowledge_chunk_links`；V0 索引主版本 HEAD**；带两条权限不变量（repo 留在 chunk 上、link 只做版本收窄）               | 2026-09-22 |
| P0-5 | V0 是否含问答生成        | **不含** —— `RagService` 无 `answer`，不做 `AnswerGenerator` / `ask_apis`，P5-8 与 P7-5 已删                                              | 2026-09-22 |
| P0-6 | 整体替换粒度（L0）       | **`provider` 字段支持「内置枚举 \| npm 包名」**，改 YAML + 重启即生效；启动期自检；config.ts 作开发逃生口                                 | 2026-09-22 |

---

## 待确认

> 已定案的项保留在列表中并标注结果，便于回溯。

1. **L0 整体替换的粒度**：客户要换整条管线，还是只需换检索后端？
2. **V0 是否要问答生成**，还是仅检索？
3. ~~中文稀疏检索选哪条路~~ → **已定案：E（应用侧 jieba，`cutForSearch`）**，见 P0-3。
4. **是否接受「V0 只索引活跃版本」**？
5. **`rag.vectorStore.indexType` 是否从配置移除**（它本质是 DDL 期决策，YAML 改了不生效）？
6. ~~embedding 维度固定 1024~~ → **已定案：固定 1024**，见 P0-2。
7. **评测集由谁标注、规模多少**（PRD §8 亦列为未决项）？

---

## 变更日志

| 日期       | 变更                                                                                                                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-09-22 | 初版：按设计文档拆出 9 个阶段、58 个任务                                                                                                                                                                                                                                       |
| 2026-09-22 | P0-3 spike 完成（报告：[rag-spike-p0-3.md](../tech/rag-spike-p0-3.md)）；据实测细化 P3-2 / P3-3 / P4-5                                                                                                                                                                         |
| 2026-09-22 | **P0-3 定案：采用 E（应用侧 jieba，`cutForSearch`）**；新增 P2-9 分词器任务，P3-1 增加 `tokenizer_version`，P3-2 定为 `search_text` + generated column                                                                                                                         |
| 2026-09-22 | **P0-2 定案：维度固定 1024 + 记录生产者身份 + 一个部署只有一个活跃模型**；与 P0-3 的 `tokenizer_version` 合并进 P3-1 一次迁移                                                                                                                                                  |
| 2026-09-22 | 精简 P0-3 spike 报告（380 → 198 行，改为「对比优先」结构）；删除一次性探查脚本 `scripts/rag-spike/`                                                                                                                                                                            |
| 2026-09-22 | **Phase 0 收尾：P0-1 / P0-4 / P0-5 / P0-6 全部定案。** P0-1：模型调用能力归 `@apigent/core/ai`、embedding/rerank 归 rag；P0-4：chunk 内容寻址 + links 表（含两条权限不变量）；P0-5：不含问答，删除 P5-8 / P7-5；P0-6：provider 支持 npm 包名 + 启动期自检                      |
| 2026-09-22 | **P1-1 完成**：新增 `@apigent/core/ai`（model + transport），`@apigent/server/ai` 变 shim；删除 `LLMProvider` / `EmbeddingProvider` 与容器死 stub；补 transport / model 单测；修 CLAUDE.md 与 tech-design 的文档漂移                                                           |
| 2026-09-22 | **Phase 1 完成（5/5）**：P1-1 模型出口收敛；P1-2 容器通用注册 API（记下一个缺口：「provider 写包名」必须与启动期自检同时落地，否则失败时机从配置校验期退化到运行期）；P1-3 `LoggingContext` 加 `traceId`；P1-4 `otlp` 命名统一（纯文档）；P1-5 配置槽 checklist 写进 CLAUDE.md |
