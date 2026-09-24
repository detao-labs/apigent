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

- [x] **P0-6 冻结整体替换粒度（L0 是否进 V0）** → **定案：`provider` 字段支持「内置枚举 | npm 包实现」，改 YAML + 重启即可切换**
  - **统一规则：`rag.*` 的 `provider` 字段接受两种取值 —— 内置枚举值，或第三方 npm 包实现。**
    ```yaml
    rag:
      embedding:
        provider: openai # ① 内置枚举
      retrieval:
        reranker:
          # ② 第三方包（局部替换）：显式判别，见下方「形态修订」
          provider: package
          package: "@acme/apigent-rerank-v2"
          options: { endpoint: "https://rerank.example.com" }
    ```
  - **形态修订（2026-09-22 定案 B）。** 原案是让 `provider` 直接写包名；实测这会让 `EmbeddingConfig` / `VectorStoreConfig` / `SearchStoreConfig` / `RerankerConfig` 这些判别联合出现 `provider: string` 分支 —— **TS 收窄失效**（`provider === "qwen"` 无法再排除第三方分支，`apiKey` 等字段退化成 `unknown`），且这些配置节点只能放弃 `.strict()`，等于把「配置写错」从启动期推到运行期（P1-2 记过的同类行为退化）。
    **改为显式判别：`provider: package` + `package: <npm 包名>` + `options: <该包自己的配置>`。** 代价是用户切方案时多改一个键；换来判别联合的类型收窄、`.strict()`、失败时机（配置校验期）全部保留。
    范围：**只放开 `rag.*` 的 provider 字段**。其他段（db / storage / queue / observability）的配置节点带必填凭据（`bucket` / `redisUrl` / `apiKey`），放开后只能透传、等于放弃这些节点的 typo 检测，需要各自单独决策。
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

- [x] **P2-1 建 `packages/rag` 包骨架**
  - 交付：`package.json`（exports 按设计要求分层）、`tsconfig.json`、`vitest.config.mts`、空 barrel。
  - 验收：`pnpm --filter @apigent/rag typecheck` 通过。
  - **完成记录（2026-09-22）：** `packages/rag` 按 `packages/core` 的约定建好（无 build 脚本、`main`/`exports` 直指源码、同一套 tsconfig/vitest 配置）。exports 目前只声明 `"."` 与 `"./contracts"`、`"./tools"`——**其余 subpath 随各自任务增量添加**，不提前声明指向不存在文件的路径（那会变成「模块找不到」而不是「未导出」的迷惑错误）。依赖：`@apigent/core`（workspace）+ `zod`；`ai` 与 `@node-rs/jieba` 到用到时再加。

- [x] **P2-2 `contracts` 子模块**
  - 交付：`RetrieveRequest` / `RetrieveResult` / `RetrievedChunk` / `IndexRequest` / `IndexReport` / `RagScope` / `RagTraceSummary` / `RagDocument` / 错误类 / 枚举常量（chunk level 等）。
  - 约束：**零重依赖**（不得 import db / pg / drizzle），客户端可安全 import。
  - 验收：类型自洽；`RagScope.repositoryIds` 必填（不存在「不传 = 全库」的形态）。
  - **完成记录（2026-09-22）：** `src/contracts/{types,errors,index}.ts`。
    - 相对设计稿的一处调整：`RagScope.versionIds` → **`commitIds`**。P0-4 定案后检索按 **commit** 收窄（chunk 内容寻址 + `knowledge_chunk_links`），不再按 version。已在注释里写明「注意是 commit 而非 version」。
    - 设计稿里的 `AnswerRequest` / `AnswerResult` 未落地——P0-5 定案不含问答。
    - 错误类型：基类 `RagError`（带 `code`，便于 MCP / API route 映射协议错误码）+ `RagConfigError` / `RagIngestError` / `RagDependencyError`。注释里明确「**降级不抛异常**，走 `RetrieveResult.degraded`」。
    - 把 `RagDocumentSource` 也放进契约（设计稿里属阶段接口）——它是「API 知识 → 可检索文本」的唯一定义，评测要对它做 A/B，属于契约而不只是实现细节。

- [x] **P2-3 `tools` 子模块**
  - 交付：`search_apis` 工具定义（name / description / zod inputSchema），无执行器；按 P0-5 决定是否加 `ask_apis`。
  - 验收：只依赖 zod；不被 `@apigent/rag` 顶层 import。
  - **完成记录（2026-09-22）：** `src/tools/index.ts` 只 import zod。`search_apis` 入参：`query`（必填）+ `repositoryId` / `organizationId` / `projectId` / `topK`（1–50）/ `mode`（fast｜deep），`.strict()` 拒绝未知键。**不做 `ask_apis`**（P0-5）。
    - 关键设计：`RagToolDefinition` 与 core 的 `AgentToolDefinition` **结构兼容**，所以能直接注册进 `AgentToolRegistry`，而 `tools` 模块无需依赖 core。这条由测试里的**编译期断言**钉住（把工具赋给 `AgentToolDefinition<SearchApisInput>`），否则将来改了形状要到 P6-2 才发现。
    - 8 个测试：最小入参、全部可选字段、空 query 拒绝、未知键拒绝、topK 上限、名称与 scope、无 `ask_apis`、结构兼容断言。
  - **命名定案（2026-09-22）：工具名 `snake_case`、参数名 `camelCase`。** 已写入 `CLAUDE.md` → External Surface Naming。
    - 参数名：`query` / `repositoryId` / `organizationId` / `projectId` / `topK` / `mode`。
    - 依据是两者**角色不同**：工具名是**协议面的标识符**（出现在客户端配置、白名单、日志、审计里，且与其他 server 共享命名空间，客户端常加前缀）→ 跟生态走 snake_case；参数名是**本 server 自己的数据契约**（JSON Schema properties，无跨系统命名空间）→ 用 camelCase 与内部类型一致，省掉一层字段名映射。
    - **查证了 MCP 官方规范**（`server/tools` → "Tool Names"）：规范只约束工具名（1–128 字符、大小写敏感、仅 `[A-Za-z0-9_.-]`、server 内唯一），**对大小写风格中立**（其示例含 `getUser` / `DATA_EXPORT_v2`），**对参数名完全未提** —— `inputSchema` 交给 JSON Schema，`properties` 键名由 server 自定。所以这个分工是我们的约定，不是规范要求。
    - 附带好处：`packages/core` 既有工具本来就是「名 snake、参数 camel」，与新规则一致 —— **不需要任何迁移，也不会破坏 LLM 已学会的 tool call 参数名**。（此前一度为此新建的 P6-6 任务已撤销。）
    - 补了一条测试钉住约定：`repositoryId` 被接受、`repository_id` 被拒绝。

- [x] **P2-4 `RagTelemetry` 端口 + `LoggerTelemetry`**
  - 交付：端口接口 + noop + logger 实现（输出 `rag.query` / `rag.stage` / `rag.degraded` 结构化事件）。
  - 验收：RAG 源码中不存在 `@opentelemetry` import；telemetry 抛错不影响检索（fail-open）。
  - **完成记录（2026-09-22）：**
    - 端口放 `contracts/telemetry.ts`（`RagTelemetry` / `RagSpan` / 类型化的 span 与指标名 / `RagLoggerPort`）—— 它是 **RagService 与宿主之间的契约**（宿主注入 telemetry），且零重依赖。实现放 `src/telemetry/`（noop / logger / fail-open）。
    - **脱敏在写入侧收口**：`RagSpanAttributes.query` 由调用方按 `rag.telemetry.recordQueryText` 决定是否写，后端不承担脱敏责任 —— 否则每个后端都要各实现一遍策略。chunk 正文永不进属性。
    - **`LoggerTelemetry` 依赖注入的 `RagLoggerPort`，不 import server 的 logger** —— 依赖方向不允许 rag → server（P1-3 记下的接线约束在这里落地）。server 侧写几行适配器即可接上 `logInfo/logWarn/...`，`traceId` 由 server 的 ALS 上下文自动带上，无需 rag 参与。
    - 加了 `failOpenTelemetry()` 装饰器：端口契约要求实现 fail-open，但不能指望第三方做到，所以由**一处**包住注入的 telemetry（P2-6 的 `createRagService` 调用它），而不是让每个阶段判空。
    - `rag.stage` 默认 info（按 rag-observability.md 示例），提供 `stageLevel: "debug"` 逃生开关 —— 一次检索约 8 个阶段事件，量大时可降级。
    - 补 14 个测试：logger 的 4 类事件与字段、fail-open（含"每个方法都抛错"的第三方实现）、以及一条**源码扫描守卫**（禁止 `@opentelemetry` import，跳过注释行、排除守卫自身，并自检守卫非空跑）。

- [x] **P2-5 `testing` 子模块（确定性替身）**
  - 交付：`hashEmbedder`、`memoryIndex`、`RecordingTelemetry`、fixture `ragDocumentSource`。
  - 验收：无网络、无 API key 即可跑完整检索链路。
  - **完成记录（2026-09-22）：** `src/testing/{hash-embedder,memory-index,recording-telemetry,fixture-document-source,index}.ts`，新增 `@apigent/rag/testing` subpath。**不进顶层 barrel**（顶层是生产消费入口，挂测试替身会诱导产品代码 import）。
    - **顺带落地两个阶段端口** `contracts/stages.ts`：`Embedder` / `DenseIndex`。原因：替身必须实现某个接口才有意义，而端口是「第三方 provider 的 peerDependency 目标」，放 `contracts/`（零重依赖、客户端可 import）比放实现目录更合理。其余阶段端口（SparseIndex / Tokenizer / Reranker / QueryRewriter / Fusion / ContextExpander）**随各自任务增量添加**，不提前声明。
    - **三处契约微调**（都记在这里，避免与 P2-2 的记录冲突）：① `RagDocument` 新增可选 `organizationId` —— chunk 的 `organization_id` 快照列（P0-4），索引层按它响应 `scope.organizationId`，不再回表 join；② `DenseChunkRecord.commitIds` 是 `knowledge_chunk_links` 的**内存等价物**，`unlink()` = 删 link，记录只在**最后一个 link 消失**时才 GC（P0-4 防误删规则）；③ `DenseIndex` 的过滤语义写进端口注释 —— **权限打在 chunk、版本打在 link、`filters` 独立 AND，三者都在排序与 `limit` 之前**。`scope.projectId` **有意不在索引层过滤**：双层规则下 Project 只决定「能否看到项目」并据此收窄 repo 集合（`resolveSearchScope()`，P5-4），索引层再按 project 过滤等于长出第二套授权模型。
    - `hashEmbedder`：FNV-1a + hashing trick（符号位 + sublinear TF），**既确定性又可排序** —— 共享词元越多余弦越高，否则 hit@k / MRR 在 CI 里没有意义。中文按「单字 + 相邻二字组」切、英数按连续串切，**零依赖**（不引 jieba / fastembed）。注释与文档都写明：**它不是分词器，也不是检索质量基线**，正式分词器是 P2-9。
    - `memoryIndex`：维度校验 fail-fast（第一条写入定维度，之后混维度直接抛 `RagConfigError`，落地 P0-2）；按 `embeddingModel` 过滤（旧模型向量视为待重索引）；**同分按 `chunkKey` 稳定排序**（否则 Map 插入顺序会泄漏进排名，「同输入同排名」这条评测前提就不成立）。
    - `RecordingTelemetry`：时钟可注入（断言精确 `durationMs`，而不是 `>= 0`），附 `spanNames()` / `spansNamed()` / `degradedReasons()` / `stageMs()` / `reset()`；`stageMs()` 累加同名子阶段并排除根 span（根的时间含子阶段，混进来会重复计算）。
    - fixture `ragDocumentSource`：手写语料覆盖**中英双语、分层 parent、跨仓库、跨组织**（`repo-legacy` 里的退款文档专门用来钉「跨组织不泄漏」）；`load()` 校验 `scope.repositoryIds`，越权返回空；返回深拷贝，调用方改文档不会污染下一次 load；可注入 `error` 走摄取失败路径（摄取失败是**抛错**，不是降级 —— 降级是检索侧概念）。
    - 有意记下的近似：fixture **忽略 `IndexRequest.endpoints`**（返回全集）。这是**安全方向**的近似 —— 期望集合是超集，对账式同步不会因此误删 chunk。已写在代码注释里。
  - 验证：`pnpm --filter @apigent/rag test` 9 文件 69 例（新增 46 例）；`pnpm -r typecheck && pnpm -r lint && pnpm -r test` 全绿。关键断言：`发货` 召回 `GET /shipments/{id}`、退款查询不跨组织泄漏、空 scope 返回 `[]` 而非抛错、维度不一致 fail-fast。

- [x] **P2-6 `pipeline` + `createRagService()`**
  - 交付：阶段注册表 + 编排；所有阶段靠注入组装，**管线内不得有隐藏全局单例**。
  - 验收：换掉任一阶段注入即可改变行为，无需改管线代码。
  - **完成记录（2026-09-22）：** `src/pipeline/{types,registry,service,index}.ts`。
    - **装配契约**：`createRagService({ registry, providers, config, telemetry, clock, createTraceId, deps })`。`providers` 每阶段一个 `{ name, options }`，`name` 就是 P0-6 的取值面（内置枚举 | npm 包名）；工厂拿到 `{ options, deps }`，`deps` 是 `Record<string, unknown>` 袋子 —— rag 不能依赖 `pg` / `drizzle`，句柄类型由**注册方**（server / 第三方包）自己声明。
    - **注册表**：按阶段分表（`documentSource` / `embedder` / `denseIndex`），未注册名字解析时 fail-fast 且**报出已注册名单**；同名重复注册以后注册者为准（对齐 P1-2 的三条注册契约）。只登记 P2-6 真能装配的阶段，避免出现「注册表里有、管线里没有」的死槽位。
    - **装配在构造期完成** = P0-6「启动期自检」的落点：配置里把 provider 名字写错，`createRagService()` 当场抛 `RagConfigError`，而不是等第一次检索才静默返回空。
    - **管线不 import 任何实现**：`pipeline/**` 只 import `contracts` 与 `telemetry`，具体实现全部由注册方注入 —— 这就是「不得有隐藏全局单例」的可检查形态（P2-8 的 lint 规则会把它变成机器检查）。
    - **降级 vs 抛错的边界**（写进代码注释，不靠记忆）：embedding 失败**有退路** → 空结果 + `degraded: embedding_unavailable` + `strategy: fallback` + `recordDegradation`；向量库检索失败**无退路**（Phase 2 只有稠密一路）→ 抛 `RagDependencyError`，并由 `searchDense()` 统一把第三方错误包装成稳定 `code`（P5-1 加入稀疏一路后这里会变成「降级到 sparse」的返回路径）；摄取失败 → 抛（`documentSource` 的错误包装成 `RagIngestError`）；**空 scope（无权限）→ 空结果且不打降级标记**（授权结果不是故障），且不调用 embedder。
    - **索引语义**：`IndexRequest.commitId` 缺省时**不写 link** → 该 chunk 在按 commit 收窄的检索里查不到（fail-closed）；「缺省 = 主版本 head」需要读 DB，属 P4-7。embedder 返回条数与文档数不一致直接抛 `RagIngestError` —— 向量错位会把 A 的向量写到 B 的内容上，是**静默错误**。
    - **分数**：契约承诺 `score` 0-1，而稠密余弦可为负 → Phase 2 用 `(cos+1)/2` 单调映射占位，P5-1 的融合阶段用自己的最终分取代。
    - **`health()`**：空索引 → `degraded`（组件通但不能服务），有内容 → `ok`，索引抛错 → `unavailable`（健康检查自己绝不抛，否则故障时拿不到任何信息）。
    - **有意留的缺口**（代码头注释里有一张表）：`content_hash` 复用与对账式删除（P4-6，`chunksSkipped/Deleted` 恒为 0 而不是假装有值）；`index_empty` 降级（判断「本 scope 内无内容」需要 scope 级计数，SQL 适配器里做才便宜且正确 → P4-4）；`matchReason` / `highlights`（P5-2 / P5-3）；`rerank` / `expand` / `mode: deep` 请求开关（无对应阶段，因此不产生行为差异）。
  - 验证：rag 11 文件 94 例（新增 25 例），含「换 documentSource / 换 denseIndex 即改行为」「装配期 fail-fast」「embedding 失败降级」「索引失败抛 RagDependencyError」「空 scope 不调用 embedder」「跨组织不泄漏」「恶意 telemetry 下仍能检索」；`pnpm -r typecheck && pnpm -r lint && pnpm -r test` 全绿。

- [x] **P2-7 端到端单测（含中文查询）**
  - 覆盖：正常召回、空召回降级、telemetry 记录、中文查询命中。
  - 验收：`pnpm --filter @apigent/rag test` 全绿。
  - **完成记录（2026-09-22）：** `src/pipeline/e2e.test.ts`（7 例）—— Phase 2 退出条件的直接证据。
    - 与 `service.test.ts` 的分工：那边按行为逐条钉契约，这边只跑**整链路**，并附一张迷你黄金集（排序质量）。
    - 关键断言：写入 6 个 chunk → 中文查询 → top1 + trace 完整 + 无降级；embedding 不可用 → **降级标记而不是 500**，且 trace 仍完整（调用方能解释「为什么是空的」）；三条中文查询（发货 / 退款 / 优惠券核销）**top1 全中**；英文查询命中同一接口的英文 chunk；未索引仓库 = **空召回而非降级**（`empty_rate=1` 与 `fallback_rate=0` 分开统计，验证两条指标确实独立）；重复索引同一 commit 幂等（chunk_key 内容寻址）；**任何 span 属性都不含 chunk 正文**（脱敏不变量，用 fixture 正文片段做反向断言）。
    - 顺带对齐：`DEFAULT_PIPELINE_CONFIG` 取 20/10，与 `DEFAULT_RAG_CONFIG.retrieval` 的 `coarseRankTopK` / `fineRankTopK` 一致 —— 两处默认值不同会产生「没读配置时与读配置时行为不同」这种最难查的偏差。
    - ⚠️ **发现一个待决策点，转交 P4-4 / P5-1**：现有配置**没有相似度阈值槽位**（如 `minScore`），因此稠密路永远返回 top-K，`empty_rate` 只在 scope 无候选时才非零 —— 这会低估真实空召回。是否引入阈值（放配置还是放请求参数）要在 P4-4 落 SQL 时一并决定，因为阈值在 pgvector 里是**查询内的 SQL 条件**，而做成管线里的后置过滤会让 `LIMIT` 语义错位（先截 top-K 再过滤 → 可能返回 0 条，明明有更多候选）。已写入 P4-4。
  - 验证：rag 12 文件 101 例；`pnpm -r typecheck && pnpm -r lint && pnpm -r test` 全绿。

- [x] **P2-8 客户端边界与依赖方向约束**
  - 交付：lint 规则 —— `packages/rag/**` 禁止 import `@apigent/server*`；顶层 barrel 不导出纯类型便利入口（避免诱导客户端 import 顶层）。
  - 验收：故意写一句违规 import 会被 lint 拦住。
  - **完成记录（2026-09-22）：**
    - `eslint.config.mjs` 新增 RAG 专用块（`files: packages/rag/src/**/*.ts`，排除 `*.test.ts`），三条 `no-restricted-imports`：① 禁止 `@apigent/server` / `@apigent/server/*`（依赖方向）；② 禁止 import `**/testing/**`（生产代码不得用测试替身）；③ 禁止 `**/adapters/**`（管线只认识端口与名字）。**用 lint 而不只靠测试**：越界 import 应该在写下的那一刻报错，而不是等 CI 跑完测试才红。
    - **顶层 barrel 改为只转发类型**：`export type * from "./contracts"`（TS 5.0+ 语法）。原先的 `export *` 让客户端可以 `import { CHUNK_LEVELS } from "@apigent/rag"` 拿到**值** —— 那条 import 会把整条管线（含 `node:crypto`）打进浏览器包；而 `import type` 会被编译期擦除，是安全的。所以「禁止的是值，不是类型」是最小且精确的约束。值一律走 `@apigent/rag/contracts`。
    - 新增 `src/boundaries.test.ts`：lint 表达不了的结构约束用测试钉住（`export type *` 与 `export *` 在 lint 眼里一样，但后果差一个浏览器包）+ 一条源码扫描守卫覆盖依赖方向（双保险，沿用 P2-4 的 `no-otel.test.ts` 写法）。三条断言都带**非空跑自检**。
  - 验收取证：临时加了一个违规文件（`from "@apigent/server/ai"` + `from "./testing/hash-embedder"`），两层都拦住了 —— eslint 报 2 个 error（附指向设计文档的中文说明），`boundaries.test.ts` 的守卫同时失败；随后删除该文件并复跑全绿。
  - 验证：rag 13 文件 106 例；全工作区 typecheck / lint / test 全绿（eslint 配置改动影响所有包，所以跑了全量）。

- [x] **P2-9 中文分词器阶段（应用侧 jieba）** ← P0-3 定案产物
  - 交付：`Tokenizer` 阶段 + `@node-rs/jieba` 适配器。
    - 必须用 **`cutForSearch`**（搜索模式），**不得用默认 `cut`**：实测默认模式把「发货单」切成单个词元，用户查「发货」命中为 0。把这条写进代码注释与测试。
    - 同时输出**标识符归一化**结果（method / path / operationId → 小写 + 非字母数字转空格），供稀疏索引使用。
    - 暴露 `tokenizerVersion`（库版本 + 词典版本 + 分词模式），供 P3-1 写入索引元数据。
  - 约束：分词器实例是进程级单例（词典常驻内存），首次加载有开销；三个进程（平台 / worker / MCP 网关）各加载一次，要确认内存与冷启动可接受。
  - 可选增强：领域词典（退款 / 优惠券 / 库存 …）通过 `loadDict` 注入，词典内容与版本一并纳入 `tokenizerVersion`。
  - 验收：`余额` / `发货单` / `优惠券` 切分正确；「发货」能命中「发货单」；同输入重复调用结果稳定。
  - **完成记录（2026-09-22）：** `src/stages/{identifiers,jieba-tokenizer,index}.ts` + `@apigent/rag/stages` subpath + `Tokenizer` 端口（`contracts/stages.ts`）。依赖 `@node-rs/jieba@2.0.3`（预编译二进制，无需编译）。
    - **① `cutForSearch`，不是 `cut`。** 有一条专门用例直接钉这件事：`overlap("发货", "发货单查询接口：按发货单号…")` 必须非空；文件头写明「别改成 `cut`」。这是本方案唯一会**静默**掉召回的坑（不报错、不告警）。
    - **② 标识符归一化独立成纯函数** `normalizeIdentifiers`（`src/stages/identifiers.ts`）：小写 + 非字母数字转空格 + **去重保序**，CJK 保留（path 里可能有 `/订单/{id}`）。它同时挂在 `Tokenizer` 端口上 —— 三个稀疏 provider（jieba / bigram / simple）共用同一行为，各写一遍必然漂移。
    - **③ 版本串** = `cutForSearch@jieba-2.0.3:dict=builtin:hmm=1:norm=v1`（库版本 + 分词模式 + 词典标识 + 归一化实现版本）。P3-1 直接把它写进 `tokenizer_version`。库版本运行时读已安装包的 `package.json`，读不到才用兜底常量；有一条测试断言兜底常量与已安装版本一致，所以它不会悄悄过期。
    - **惰性加载是刻意的**：`@node-rs/jieba` 是原生模块、`@node-rs/jieba/dict` 一 import 就把词典读进内存。静态 import 会让**任何** import 到 `./stages` 的进程付这个成本（哪怕 `searchStore.provider: none`，哪怕只是想用 `normalizeIdentifiers`）。改用 `createRequire` 惰性加载后，成本推迟到工厂调用时 —— 正好是启动期，也是 fail-fast 的好位置。
    - **进程级单例 + 领域词典**：`Jieba.withDict()` 只做一次（P0-3 约束 2）。`loadDict` 是**增量合并**，同一进程加载第二套词典会污染第一套、切分结果从此不可复现 → 遇到第二个不同 `id` 直接抛 `RagConfigError`，而不是静默合并（P0-3 约束 3）。有测试。
    - **有意不做**：**不拆 camelCase**（`refundOrder` → `refundorder`）。P0-3 定案只写「小写 + 非字母数字转空格」；加它会改分词口径 → `tokenizer_version` 变 → 必须 REINDEX，所以它是个独立决策点而不是顺手优化。当前行为已被测试固定住，将来要改测试会提醒同步改版本号。
    - **给 P4-5 的接口约定**：索引侧与查询侧必须用**同一实例、同一模式**；查询词元里已经滤掉纯标点，但拼 tsquery 时仍要做一次白名单过滤（防 `:` `&` 之类破坏语法）。
    - 顺带把 P2-8 的 lint 规则加严一档：`pipeline/**` 连 `**/stages/**` 也不许 import（管线只认识端口与名字）。
    - **依赖版本精确固定**（`"@node-rs/jieba": "2.0.3"`，不是 `^2.0.3`）：`dict.txt` 随包发布，切分口径又被持久化进 `tokenizer_version`，所以版本一动就得全量 REINDEX。固定版本让升级变成一次**显式的、带 REINDEX 的** diff，而不是 `pnpm update` 的副作用（锁文件本来就冻结了解析结果，这条是为了让升级动作可见）。同时它也是工作区里唯一一个原生预编译依赖，升级风险高于普通纯 JS 包。
  - 验证：rag 15 文件 122 例（新增 16 例：切分质量 5 + 版本串 3 + 端口委托 1 + 词典 1 + 标识符归一化 6）；全工作区 typecheck / lint / test 全绿。

- [x] **P2-10 provider 包名加载 + 启动期自检** ← P0-6 定案的最后一块（本任务为 2026-09-22 补记）
  - 背景：P0-6 定案里「`provider` 字段直接写 npm 包名」与「启动期自检」是两条必做项。P2-6 落地了注册表与解析（名字写错启动即失败），但**按包名动态 `import()` 与导出形状校验**还没有实现；P1-2 也记过同一个缺口（配置类型仍只接受固定字面量，写包名会被 zod / TS 挡下）。
  - 交付：① `loadStageFactory(kind, name)` —— 先查注册表，未命中则按包名动态加载，并校验导出形状（缺哪个导出要报出来）；② 配置类型放宽为「内置枚举 | 包名」，且**必须与启动期自检同时落地** —— 否则失败时机从「配置校验期」退化成「运行期」，那是行为退化。
  - 验收：不存在的包名 / 导出形状不对的包 → 启动期可读错误；内置枚举仍走原路径；配置里写包名不再被 zod / TS 拒绝；同名外部包可覆盖内置实现。
  - 约束：只接受**已安装为依赖的包名**，不按文件路径加载（配置文件常被复制、被工单传递，路径会让它变成任意代码执行入口）。第三方包把 `@apigent/rag/contracts` 声明为 peerDependency。
  - **进展（2026-09-22）—— ① 已落地，② 待决策（阻塞）：**
    - ① `src/pipeline/loader.ts`：`loadStageFactory(registry, kind, name, { loadModule })`、`preloadStageProviders()`、`STAGE_FACTORY_EXPORT_NAMES`。16 例测试。
      - **内置命中不走加载路径**（用 `vi.fn()` 断言未被调用）；包名 → 动态 `import()` → 形状校验 → **注册进 registry**，所以同一 registry 上第二次解析不再 import。
      - **导出形状**：命名导出 `createDocumentSource` / `createEmbedder` / `createDenseIndex`，或 `default` 工厂函数。错误信息必须同时说清「期望什么 + 实际有什么」。
      - **文件路径被明确拒绝**：`./x`、`../x`、`/abs/x`、`C:\x`、`file:/x` 五种形态各一条用例，且断言**根本不调用加载器**（P0-6 的安全边界：配置常被复制转发，路径 = 任意代码执行入口）。
      - **`preloadStageProviders()` 是启动期自检入口**：返回 `[{ kind, name, source: "registry" | "package" }]` 供启动日志打印（P0-6 要的「成功 / 失败信号」），任一项不可用即抛 `RagConfigError` 让进程启动失败。自检只做「加载 + 形状校验」，**不实例化**（连不上 DB 不该让自检失败）。
      - 错误信息兼顾两种可能：包没装 vs 内置枚举还没接线（例如 P4-4 之前的 `pgvector`），并列出该阶段已注册的实现。
    - ② **配置面放宽（2026-09-22 定案 B 后完成）**：
      - 新增 `provider: package` + `package: <npm 包名>` + `options: {}` 的显式判别分支，挂到 `VectorStoreConfig` / `EmbeddingConfig` / `SearchStoreConfig` / `RerankerConfig` 四个 union（`SearchStoreConfig` 由「单个 interface」改为「union」，原 interface 更名 `PgFtsSearchStoreConfig`）。
      - **包名规则只有一个实现**：`packages/core/src/config/provider-package.ts` 导出 `NPM_PACKAGE_NAME_PATTERN` / `isNpmPackageName` / `NPM_PACKAGE_NAME_HINT`，zod 校验与 `loadStageFactory` 共用 —— 否则会出现「配置校验通过、加载时被拒」这种自相矛盾的启动失败。
      - 示例 YAML 补了 4 个注释示例（vectorStore / embedding / reranker / searchStore）。`defaults.ts` 不动（新分支是可选的，默认仍是内置实现）。
      - **`file-loader.ts` 不需要改**：B 方案没有把 provider 拓宽成 `string`，按名字索引环境变量的写法（`embApiKeyMap[provider]`）与各处 `provider === "qdrant"` 判断全部照旧。
      - 测试 +22 例（core 51 → 73）：四个 union 各自覆盖「带 options 的 scoped 包」「不带 options」「路径被拒（4 种形态）」「缺 `package` 字段」「节点级 typo 仍被 `.strict()` 拒绝」。
      - ⚠️ **发现一个新缺口（已记为 P3-7）**：P0-6 里的 **L0 整体替换没有配置槽** —— `RAGConfig` 顶层没有 `provider`，所以「换掉整条管线」目前无处声明。

---

## Phase 3 — 数据模型与配置对齐（迁移）

**目标：** 让表结构与配置能承载 Phase 2 验证过的契约。
**准入：** P0-2 / P0-3 / P0-4 有结论；Phase 2 完成。
**退出条件：** 迁移可正向 / 回滚执行；`pnpm db:check` 与 schema 一致；配置校验通过。

> 时序要点：本阶段必须在**任何真实摄取写入之前**完成，但不必在 Phase 2 之前 —— 那时还没有数据要迁移。

- [x] **P3-1 `knowledge_chunks` 增加「生产者身份」列**
  - 交付：一次迁移同时加两组字段。
    - **向量侧（P0-2 定案）**：`embedding_model`（形如 `qwen:text-embedding-v4`）/ `embedding_dim` / `embedding_updated_at` + 必要索引；检索按当前模型过滤，不匹配的行视为待重索引、不参与召回。
    - **文本侧（P0-3 定案）**：`tokenizer_version`，记录该行文本是哪个分词器版本 + 词典版本 + 分词模式产出的；检索时校验，不一致则拒绝检索或强制重索引。
  - 说明：两者本质是同一类问题——「这行数据是用哪个模型 / 哪个版本产出的」，合并一次迁移。
  - **时机红利**：`knowledge_chunks` 当前 **0 行**，本迁移零成本、无需回填。（spike 实测确认）
  - 验收：迁移命名可读（`pnpm db:generate -- --name=...`）；新旧模型向量混表的场景在类型 / SQL 层面被排除。
  - **完成记录（2026-09-22）：** 迁移 `0005`（drizzle-kit 离线 diff 生成）+ schema `packages/server/src/db/schema/knowledge.ts`。**（2026-09-24 重整：本任务与 P3-2 的两条迁移已合并为 `0005_rag_chunk_producer_identity_and_search_text.sql`，见 P3-2 记录。）**
    - 4 列**全部可空**（因为 `embedding` 本身可空 —— sparse-only / 延迟回填；`tokenizer` 也可能不参与）：`embedding_model varchar(128)` / `embedding_dim integer` / `embedding_updated_at timestamptz` / `tokenizer_version varchar(128)`。
    - **新增 CHECK 约束 `knowledge_chunks_embedding_identity_check`**：向量身份必须**成套出现** —— `(embedding IS NULL) = (embedding_model IS NULL)`，dim / updatedAt 同理。这就是验收要求的「SQL 层面排除」：有向量却不知道是谁产的、多长、何时写入，数据库直接拒绝。
    - 新增索引 `knowledge_chunks_embedding_model_idx`（btree）：服务于按当前模型过滤与「待重索引」统计（`WHERE embedding_model <> $current`）。
    - **决策留痕：为什么是 4 个独立列，而不是一个 `producer jsonb`**（用户提问后确认保持列，2026-09-22）。核心理由是**失败方式**：`@apigent/rag` 的检索 SQL 是**手写字符串**（注入的 `SqlExecutor` 端口，不经过 drizzle 类型系统）——列名写错 PG 当场报 `column ... does not exist`；JSON 键写错则 `producer->>'…'` 返回 NULL、条件不成立、**该行被静默过滤**，表现为「检索突然查不到东西」。次要理由：① 类型强制（`integer` 拒字符串、`timestamptz` 拒任意字符串，JSON 里都能混进去）；② 表头既定约束 —— 身份字段要能 1:1 映射成 Milvus scalar field / ES document field；③ 与既有 `metadata` 的语义分离（那是「这条知识是什么」＝业务内容、文档源可自由填写；producer identity 是「这行数据是谁产的」＝工程元数据）。
    - 附带结论：这 4 个字段**不同质** —— `embedding_model` / `tokenizer_version` 是**查询关键**（过滤 / 一致性门禁），`embedding_dim` / `embedding_updated_at` 是**纯审计**（维度已被 `vector(1024)` 列类型强制）。将来若要精简 schema，该动的是后两个，而不是把前两个降级成 JSON。
    - **有意没加的东西**：① 没有给 `tokenizer_version` 加对称的 CHECK（如「search_vector 非空 ⇒ tokenizer_version 非空」）—— 那要等 P3-2 定下 `search_text` / generated column 的形态，现在加会在 P3-2 返工；② 没有给 `embedding_dim` 加 `= 1024` 的 CHECK —— 维度由 `vector(1024)` 强制，写死常量反而让将来换维度多一次改约束。
    - **命令形式的坑（顺手修正）**：本任务原文写的 `pnpm db:generate -- --name=…` 在 pnpm 11 下会把 `--` 原样透传给 drizzle-kit，报 `Unrecognized options for command 'generate': --`。**正确形式是 `pnpm db:generate --name=…`**（下面 Phase 3 各任务同理）。
  - 验证（离线）：`pnpm db:check` 通过（Everything's fine）；`packages/server/src/db/index.test.ts` 补了 4 列的导出断言；全工作区 typecheck / lint / test 全绿。
  - **迁移已执行（2026-09-22，本地 Docker Postgres `localhost:5433/apigent`）**：
    - 执行前检查：`knowledge_chunks` **0 行**（零成本前提成立）、已应用 5 个迁移、4 列 / 索引 / 约束均不存在。
    - `pnpm db:migrate` → `[migrate] 6/6 migrations applied`。
    - 执行后复核：4 列存在且类型正确（`integer` / `timestamp with time zone` / 两个 `character varying`，均 nullable）、`knowledge_chunks_embedding_model_idx` 存在、CHECK 定义与预期逐字一致。
    - **约束负向验收**（在事务内 + SAVEPOINT，全部 ROLLBACK，事后表仍 0 行）：① 有向量但身份全空 → 拒绝 `[23514] knowledge_chunks_embedding_identity_check`；② 有向量但只填了模型（缺 dim / 时间）→ 同样拒绝；③ 无向量且身份全空（sparse-only 形态）→ 按预期允许。
    - 说明：负向用例用 `session_replication_role=replica` 临时关掉 FK 触发器，让被测对象只有 CHECK（否则空库上没有 org/repo，插入会先被外键挡住，测不出约束本身）。该设置与所有插入都在同一事务内回滚。

- [x] **P3-2 修正 `search_vector` 形态**
  - 现状：设计文档称其为 generated column「自动同步、无窗口期」，实际是**普通列**；且 `to_tsvector(text)` 是 STABLE、不能用于 generated column。
  - P0-3 定案后的形态（推荐）：应用侧写入切好词的 **`search_text`** 列，`search_vector` 做成从它派生的 generated column：
    `GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, search_text)) STORED`
    这样分词在应用侧、tsvector 在 DB 侧确定性生成，且**保留纯 SQL 可调试性**（可以直接 `select search_text` 看到切成了什么）。
  - 验收：写入一条 chunk 后 `search_vector` 非空；`select search_text` 能看到 jieba 的切分结果；同步修正设计文档表述。
  - 部署注意（spike 实测）：`CREATE EXTENSION vector` 需要 superuser，而当前应用账号 `apigent` 恰好是 superuser；生产环境不应如此——**扩展安装必须是部署 / 迁移步骤，不是应用启动步骤**。写进部署前置条件。
  - **完成记录（2026-09-22 / 2026-09-24 重整）：** **迁移历史重整（2026-09-24，用户要求）** —— P3-1 与 P3-2 原是两条迁移（旧 `0005_rag_chunk_producer_identity.sql`、旧 `0006_rag_search_text_generated_vector.sql`），因**未上线且 `knowledge_chunks` 0 行**，已合并为单条 **`0005_rag_chunk_producer_identity_and_search_text.sql`**（旧的 0006 文件与快照删除，journal 只留一条）。
    - 合并后的 `when` **沿用旧 0006 的时间戳**：migrator 只按 `created_at` 判定已应用（读了 drizzle 源码确认），这样「已跑过旧 0005+0006」的库会被跳过、schema 与合并结果一致；只到 0004 的库 / 全新库会正常执行这一条。已实测：主库 `pnpm db:migrate` 输出 `up to date: journal has 6, database recorded 7`（无报错）；临时库全新跑完整链路 `6/6 migrations applied`。
    - 顺带修掉 `migrate.ts` 的一处误导输出：`applied > expected` 时会打印 `7/6 migrations applied`，看着像 bug，改成 `up to date: journal has 6, database recorded 7 (the extra rows are migrations that were merged before release)`。
    - **合并安全性验证**：在临时库上跑完整迁移链（0000→0005），再与主库逐项对比 `knowledge_chunks` —— **21 列 / 8 索引 / 8 约束完全一致**；`drizzle-kit check` 通过；再跑一次 `generate` 报 `No schema changes, nothing to migrate`（证明快照与 schema 同步，后续 diff 不会漂）。临时库用完即删。
    - schema 改动不变（仍是本节列出的内容，只是与 P3-1 的列合并在同一条迁移里）。
    - schema：新增 `search_text text`；`search_vector` 由普通列改为 `generatedAlwaysAs(sql\`to_tsvector('simple'::regconfig, "search_text")\`)`；**新增 `knowledge_chunks_tokenizer_identity_check`**（`(search_text IS NULL) = (tokenizer_version IS NULL)`）—— 这条正是 P3-1 记录里说「等 P3-2 定下形态再加」的那条。
    - **为什么 `simple` 而不是 `english`**：中文不靠 PG parser，而 english 的 stemming 会改动英文标识符。一参形式 `to_tsvector(text)` 依赖 GUC 且是 STABLE，不能用于生成列（spike 实测）。
    - ⚠️ **drizzle-kit 生成结果有两处必须手工修**（已写进迁移文件头，原样跑会坏）：① **顺序错** —— 它把 `ADD COLUMN search_vector`（引用 `search_text`）排在 `ADD COLUMN search_text` 之前，PG 会报 `column "search_text" does not exist`；② **静默丢索引** —— `DROP COLUMN search_vector` 会连带删掉 `knowledge_chunks_search_vector_gin_idx`，而 drizzle 认为该索引没变、不会重建 ⇒ 稀疏检索会**悄悄退化成顺序扫描**，且快照与库从此不一致（后续 generate 也看不出来）。迁移里已显式重建该索引。
    - **动真库之前的预演**：把 0006 的全部 DDL 放进一个事务跑完并 `ROLLBACK`，验证了「生成列表达式正确」「GIN 索引被重建」「约束已加」「写入 `search_text` 后 `search_vector` 自动非空且能被 `to_tsquery` 命中」「两个方向的身份约束都被拒绝」，回滚后 0 行、`search_vector` 回到非生成列（无残留）。**这一步值得固化成习惯**：DDL 迁移可以先在事务里预演。
    - 文档同步：`semantic-search.agent.md` §2.2 —— 修掉「generated column 与实现不符」的第 3 条（改为「已修 + 指向当前形态」）、把「采纳 CJK bigram」更正为 P0-3 最终定案（应用侧 jieba `cutForSearch`，bigram 仅备选）、SQL 示例整段换成 `search_text → generated search_vector` 的新形态；`rag-package.md` 新增 §12.1 部署前置条件。
    - **转出开放项（记入 P4-5）**：单输入 `search_text` **丢了字段级权重**（原设计 method/path A 级、summary B、content C）。两条候选路：① 关键标识符在 `search_text` 里重复做词频加权；② 再加一列 `search_identifiers`，生成表达式写成 `setweight(...search_text,'C') || setweight(...search_identifiers,'A')`。**P4-5 定案前该表仍为 0 行，改形态零成本。**

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

- [ ] **P3-7 L0 整体替换：`rag.provider` 配置槽 + `RagService` 工厂加载** ← P0-6 承诺、P2-10 发现的缺口（2026-09-22 补记）
  - 问题：P0-6 的示例里有 `provider: "@acme/apigent-rag-qdrant" # 整体替换（L0）`，但 `RAGConfig` **顶层没有 `provider` 字段** —— 也就是说「换掉整条管线」今天无处声明，只有阶段级替换可用。
  - 交付：① `RAGConfig` 顶层加 `provider`（缺省 `builtin`，或 `{ provider: package, package, options }`），四处同步；② `@apigent/server` 装配时按它选择：内置 = 本包的 `createRagService()`，第三方 = 加载包导出的 `createRagService`（复用 P2-10 的加载器与形状校验）。
  - 验收：YAML 写一个第三方 RAG 包名 → 重启后 `POST /api/search` 走的是那个包；包不存在 / 形状不对 → 启动期可读错误；缺省（不写）行为与今天完全一致。
  - 形态：与 P0-6 定案 B 一致 —— 显式判别，不把 `provider` 拓宽成 `string`（`RAGConfig` 是普通 object，但保持同一套写法以免用户要记两种形态）。
  - 依赖：与 P5-4（scope 解析）/ P6-1（API route）同期接线最自然 —— 那时才第一次真正构造 `RagService`。

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
  - **连带（P2-7 转来的待决策点）**：决定是否引入**相似度阈值**（如 `minScore`）。现状没有该配置槽，稠密路永远返回 top-K，`empty_rate` 只在 scope 无候选时才非零，会低估真实空召回。若引入，阈值必须是**查询内的 SQL 条件**（`WHERE embedding <=> $q < $maxDistance`），不能做成管线里的后置过滤 —— 先 `LIMIT` 再过滤会导致「明明有更多候选却返回 0 条」。

- [ ] **P4-5 稀疏索引适配器**（按 P0-3 决策）
  - 交付（`pg-fts-jieba`，默认）：
    1. 写入路径：`Tokenize(doc) → search_text → INSERT`，由 P3-2 的 generated column 产出 `search_vector`；
    2. 查询路径：**用同一个分词器实例、同一个 `cutForSearch` 模式**处理查询串，词元去重后以 **OR** 连接成 tsquery（用 AND 会几乎必然空召回），并过滤掉非 `[a-z0-9 CJK]` 的词元以免破坏 tsquery 语法；
    3. 标识符归一化结果一并写入 `search_text` 的标识符区段；
    4. 字段权重按新方案重设（原 `path` A 级权重对 `file` token 无效）。
  - **⚠️ 待决策（P3-2 转来）**：当前 `search_vector` 只由 `search_text` 一个输入派生（迁移 `0005`），**字段级权重已经丢掉**。两条候选：① 关键标识符在 `search_text` 里重复，用词频做加权（零 schema 改动）；② 加一列 `search_identifiers`，生成表达式写成 `setweight(to_tsvector('simple', search_text),'C') || setweight(to_tsvector('simple', search_identifiers),'A')`（仍是确定性生成列，但要再出一次迁移）。在 P4-7 首次写入之前该表一直是 0 行，两条路都零成本。
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

## Phase 9 — 插件 SDK 对外发布（**已决定延后：先记录，后面专门实现**）

**状态（2026-09-22）：** 方向已确认（对外提供一个 slim 契约包，插件作者 `pnpm add` 它即可），但用户明确「**先记录下吧，后面再专门实现**」。**本阶段暂不排期**，不影响 Phase 3-8。

**延后要付的代价（写在这里，免得将来惊讶）：** P9-1 没做之前，Phase 4/5 写 adapter 时会从 `pipeline/types` import 工厂签名（`RagStageFactoryContext` 等）；将来搬迁到 `contracts/` 时，这些 import 要一起改 —— 机械但要碰多个文件。

**目标：** 让外部开发者「`pnpm add <契约包>` 就能写自己的 Apigent provider 插件」，而不是只能在同一 monorepo 内加 workspace 包。
**准入：** 待确认 #9 的三个前置决策有结论（npm scope / 构建路线 / 发布节奏）。
**退出条件：** 一个仓库外的示例插件，仅依赖发布的契约包，能通过宿主启动期自检并生效。

> **为什么单独成阶段：** 它是**发布工程**，不是检索功能；混进 Phase 3-8 会把 V0 的完成条件搅浑。但其中 **P9-1（契约包边界）建议提前**：它决定「插件的工厂签名从哪个包 import」，会影响 Phase 4/5 写 adapter 时的 import 形态，事后改要动一圈。

- [ ] **P9-1 契约包边界：把插件面向的类型与常量挪进 `contracts/`**
  - 问题（实测）：插件的工厂签名现在在宿主侧 —— `RagStageFactoryContext` / `RagStageDeps` / `RagEmbedderFactory` / `RagDenseIndexFactory` / `RagDocumentSourceFactory` / `RagStageFactoryMap` 在 `pipeline/types.ts`，导出名约定 `STAGE_FACTORY_EXPORT_NAMES` 在 `pipeline/loader.ts`。
  - 交付：这些**插件面向**的类型与常量移入 `contracts/stages.ts`（宿主侧的 `RagServiceOptions` / `RagStageRegistry` / `RagPipelineConfig` 留在 pipeline），`pipeline/**` 改为从 contracts import。
  - 验收：`packages/rag/src/contracts/**` 里能拿到「写一个 embedder 插件所需的全部类型与常量」；rag 测试全绿（纯搬迁，零行为变化）。
  - 依赖：无。可以在 Phase 3 之前做。

- [ ] **P9-2 新包 `rag-contracts` + 第一条构建管线**
  - 交付：`packages/rag-contracts`（零运行时依赖），导出 `"./contracts"` 与 `"./testing"` 两个子路径；`tsc --module commonjs` 出 `dist/*.js` + `*.d.ts`，配齐 `files` / `exports` / `publishConfig` / `main` / `types`。
  - 已实测的约束：ESM 产物不可用（extensionless 相对导入 → `ERR_MODULE_NOT_FOUND`）；CJS 产物可用（实测加载成功）；契约 + 替身产物 104K 未压缩、无原生依赖。
  - 验收：`pnpm --filter @apigent/rag-contracts build` 产出可 `node -e "require(...)"` 的包；`npm pack --dry-run` 的内容清单里没有源测试文件。
  - 备选：引入 tsup/unbuild 出 ESM+CJS 双份（多一个构建依赖）；或全仓改 `moduleResolution: node16` + 显式 `.js` 扩展（侵入面最大，不建议）。

- [ ] **P9-3 宿主侧消费改造（零破坏）**
  - 交付：`packages/rag` 依赖 `rag-contracts`；`@apigent/rag/contracts` 与 `@apigent/rag/testing` 保留为 **re-export shim**（与 P1-1 处理 `@apigent/server/ai` 同一手法），既有 import 一行不改。
  - 验收：全仓 typecheck / lint / test 全绿且**无调用点改动**；`boundaries.test.ts` 与 lint 规则继续通过。

- [ ] **P9-4 版本握手：不兼容的插件必须在启动期失败**
  - 交付：契约包导出 `RAG_CONTRACTS_VERSION`；插件工厂对象需带同名版本；`preloadStageProviders()` 比对并在不匹配时抛 `RagConfigError`（错误里给出「宿主版本 / 插件版本 / 建议」）。
  - 理由：P0-6 把「版本不兼容」列为三个实现难点之一，而当前 loader 只校验导出形状。
  - 验收：伪造一个版本不匹配的插件包 → 启动期可读错误（而不是运行到一半才炸）；版本一致 → 正常通过。

- [ ] **P9-5 插件作者文档 + 示例插件 + 发布流程**
  - 交付：`docs/plugins/rag-provider.md`（导出约定、工厂签名、`options` 由包自己校验、`peerDependency` 写法、本地如何用 `link:` 调试）；一个仓库外可复制的示例插件；CI 发布步骤（`npm publish --provenance` 之类）。
  - 验收：按文档从零写一个 embedder 插件，只依赖发布的契约包，能在宿主里跑通检索。

---

## 进度看板

| 阶段                       | 任务数 | 已完成 | 状态             |
| -------------------------- | ------ | ------ | ---------------- |
| Phase 0 决策冻结           | 6      | 6      | ✅ 完成          |
| Phase 1 基础重构           | 5      | 5      | ✅ 完成          |
| Phase 2 包骨架与契约       | 10     | 10     | ✅ 完成          |
| Phase 3 数据模型与配置对齐 | 7      | 2      | 进行中           |
| Phase 4 摄取               | 8      | 0      | 未开始           |
| Phase 5 检索               | 7      | 0      | 未开始           |
| Phase 6 平台接入           | 5      | 0      | 未开始           |
| Phase 7 评估与可观测       | 5      | 0      | 未开始           |
| Phase 8 MCP 暴露           | 6      | 0      | 未开始           |
| Phase 9 插件 SDK 对外发布  | 5      | 0      | 已记录，延后实现 |

**下一个任务：** P3-3 按 P0-3 决策调整 `rag.searchStore`

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

8. ~~**`provider` 写包名时的 YAML 形态**~~ → **已定案（2026-09-22）：采用 B —— 显式判别 `provider: package` + `package: <npm 包名>` + `options: {...}`，范围仅 `rag.*` 的 provider 字段。** 落地点：`provider-package.ts`（共用包名规则）+ `types.ts` / `schema.ts` 四个 union + 示例 YAML；`defaults.ts` 与 `file-loader.ts` 无需改。原两条候选与代价保留如下，便于回溯。

   **A. P0-6 原案：`provider` 直接写包名**

   ```yaml
   rag:
     embedding:
       provider: "@acme/apigent-embedding-v2" # 节点里 provider 之外的键 = 该包的 options（透传）
       endpoint: "https://…"
   ```

   - 好处：切方案只改 `provider` 一行，其余 options 原样透传 —— 用户理解成本最低。
   - 代价 ①：这几个判别联合一旦出现 `provider: string` 分支，**TS 收窄失效**（`config.rag.embedding.provider === "qwen"` 不再能排除第三方分支，`apiKey` 会退化成 `unknown`）；`file-loader.ts` 里三处 `embApiKeyMap[provider]` 这类「按名字索引」的写法都要改成显式判断。
   - 代价 ②：该节点**失去 `.strict()`** —— 第三方 options 的拼写错误（`apkiKey`）无法在配置校验期发现，只能由包自己校验（这是第三方 provider 的固有代价，但要明确接受）。

   **B. 显式判别：`provider: package` + `package:` + `options:`**

   ```yaml
   rag:
     embedding:
       provider: package
       package: "@acme/apigent-embedding-v2"
       options:
         endpoint: "https://…"
   ```

   - 好处：判别联合的收窄、`.strict()`、失败时机（配置校验期）全部保留；`file-loader.ts` 不需要改；错误信息能精确指出「package 字段不是合法包名」。
   - 代价：切方案要改两个键（`provider: openai` → `provider: package` 再加 `package:`），比 A 多一步；偏离 P0-6 已记录的字面形态（需同步更新决策记录）。

   **建议 B。** 理由：A 省下的是「用户少写一个键」，付出的是**核心配置模块的类型安全与校验能力**；而 P1-2 已经记过一次同类教训 —— 「放宽配置类型会改变失败时机，必须先补上启动期自检，否则是行为退化」。B 让「配置错误」继续停在启动期，且不牺牲既有类型。

   8.1 **范围问题**：只放开 RAG 段（embedding / vectorStore / searchStore / reranker），还是**所有** `provider` 字段？其他段（db / storage / queue / observability / auth）的配置节点带必填凭据字段（`bucket` / `redisUrl` / `apiKey`），放开后只能透传，等于放弃这些节点的 typo 检测。**建议仅 RAG 段** —— P0-6 的动机是「RAG 的替换粒度（L0/L1）」，其他段各有自己的替换机制，要放开应各自单独决策。

9. **契约包能不能发布到 npm？**（2026-09-22 提出 —— **「第三方 provider 包」的硬前置**）。P0-6 要求第三方包把「接口所在包」声明为 peerDependency，但事实是：`@apigent/rag` 是 `private: true`，八个 workspace 包（`auth` / `core` / `rag` / `server` / `ui` / `admin` / `open` / `platform`）**一个都没发布**。所以「第三方 provider 包」今天只能在**同一 monorepo 内**实现（workspace 包），对外部开发者并不成立。
   - **A. 发布 `@apigent/rag`**：第三方可直接 peerDependency。代价是包体不小（含 pipeline / stages / `@node-rs/jieba` 原生依赖），且一旦发布就要背语义化版本承诺。
   - **B. 拆一个零依赖的 slim 契约包**（如 `@apigent/rag-contracts`，就是现在的 `contracts/` 子模块）供第三方 peerDependency，实现包保持私有。代价是多一个包要同步发布。
   - **C. V0 不对外开放**：只支持 workspace 包 / 官方包。代价是必须把文档里「第三方包」的措辞改成「workspace 包」，否则是在承诺一条走不通的扩展路径。
   - 无论选哪条，都要和**开源策略 / 发布流程**一起定（包名占用、是否租用 scope、版本策略）。P2-10 的加载器本身与这个决策无关，已落地不受影响。

   **spike 实测（2026-09-22，用户追问「能否提供一个 npm 包让插件作者 import」后做的）：**

   - 仓库现状：所有包 `main` 指向 `./src/index.ts`、无 `files`、**无 build 脚本**，devDeps 里没有任何打包器（只有 eslint / prettier / typescript / vitest）。**要发布就必须先有第一条构建管线。**
   - `tsc` 直接出产物**可行**：`contracts/` + `testing/` 合计 **104K（未压缩）**，产物里**没有** `@node-rs/jieba`、也没有 `node:` 内建依赖（实测 grep 无命中）—— 说明 slim 契约包真的可以零运行时依赖。
   - 但 **ESM 产物在 Node 下跑不起来**：`tsc --module esnext` 保留 extensionless 相对导入（`from "./hash-embedder"`），实测 `import()` 报 `ERR_MODULE_NOT_FOUND`。而 **CJS 产物实测可加载**（`require` → `{ model: "test:hash", dim: 1024 }`）。
   - ⇒ 最省事的路线是 **`tsc --module commonjs` + `.d.ts`（零新依赖，今天就能发）**；要 ESM/CJS 双份就得引入打包器（tsup / unbuild，多一个构建依赖 + 配置）。**建议先走 CJS**：插件在宿主 Node 进程里跑，CJS 包对 ESM 消费者也有 interop，代价可忽略。
   - 另一个实测出来的内容缺口：**插件作者要实现的工厂签名不在 `contracts/` 里** —— `RagStageFactoryContext` / `RagEmbedderFactory` / `RagDenseIndexFactory` / `RagDocumentSourceFactory` 与导出名约定 `STAGE_FACTORY_EXPORT_NAMES` 都在 `pipeline/`（宿主侧）。要「引入一个包就能写插件」，这些必须先挪进契约包。

   **用户决定（2026-09-22）：方向取 B —— 对外提供 slim 契约包；实现延后，先记录（见 Phase 9）。** 在此之前，「第三方 provider 包」的有效范围仍是 monorepo 内的 workspace 包 / 官方包；对外文档不要承诺「`pnpm add` 就能写插件」，直到 P9-2 发出第一个版本。

---

## 变更日志

| 日期       | 变更                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-22 | 初版：按设计文档拆出 9 个阶段、58 个任务                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-09-22 | P0-3 spike 完成（报告：[rag-spike-p0-3.md](../tech/rag-spike-p0-3.md)）；据实测细化 P3-2 / P3-3 / P4-5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-09-22 | **P0-3 定案：采用 E（应用侧 jieba，`cutForSearch`）**；新增 P2-9 分词器任务，P3-1 增加 `tokenizer_version`，P3-2 定为 `search_text` + generated column                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-09-22 | **P0-2 定案：维度固定 1024 + 记录生产者身份 + 一个部署只有一个活跃模型**；与 P0-3 的 `tokenizer_version` 合并进 P3-1 一次迁移                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-09-22 | 精简 P0-3 spike 报告（380 → 198 行，改为「对比优先」结构）；删除一次性探查脚本 `scripts/rag-spike/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-09-22 | **Phase 0 收尾：P0-1 / P0-4 / P0-5 / P0-6 全部定案。** P0-1：模型调用能力归 `@apigent/core/ai`、embedding/rerank 归 rag；P0-4：chunk 内容寻址 + links 表（含两条权限不变量）；P0-5：不含问答，删除 P5-8 / P7-5；P0-6：provider 支持 npm 包名 + 启动期自检                                                                                                                                                                                                                                                                                                                                                              |
| 2026-09-22 | **P1-1 完成**：新增 `@apigent/core/ai`（model + transport），`@apigent/server/ai` 变 shim；删除 `LLMProvider` / `EmbeddingProvider` 与容器死 stub；补 transport / model 单测；修 CLAUDE.md 与 tech-design 的文档漂移                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-09-22 | **Phase 1 完成（5/5）**：P1-1 模型出口收敛；P1-2 容器通用注册 API（记下一个缺口：「provider 写包名」必须与启动期自检同时落地，否则失败时机从配置校验期退化到运行期）；P1-3 `LoggingContext` 加 `traceId`；P1-4 `otlp` 命名统一（纯文档）；P1-5 配置槽 checklist 写进 CLAUDE.md                                                                                                                                                                                                                                                                                                                                         |
| 2026-09-22 | **P2-1 ~ P2-3 完成**：`packages/rag` 骨架落地（exports 增量声明）；契约落定（`RagScope.commitIds` 取代 `versionIds`，无 answer 相关类型）；`search_apis` 工具定义（与 core 的 `AgentToolDefinition` 结构兼容，由编译期断言钉住）。**遗留决策：工具入参 camelCase vs snake_case，需在 Phase 8 暴露 MCP 前敲定。**                                                                                                                                                                                                                                                                                                       |
| 2026-09-22 | **确立对外命名规则**（写入 CLAUDE.md → External Surface Naming）：**除 MCP 工具名外一律 camelCase** —— MCP 工具名 `snake_case`、MCP 参数名 `camelCase`、平台 REST JSON `camelCase`、内部 TS 类型 `camelCase`。依据：查证 MCP 官方规范 `server/tools`「Tool Names」—— 规范只约束工具名字符集与唯一性、**对大小写风格中立**（示例含 `getUser`）、**对参数名完全未提**。撤销此前新建的 P6-6（core 既有工具已符合该规则，无需迁移）；Phase 6 任务数 6 → 5。                                                                                                                                                                |
| 2026-09-22 | **P2-4 完成**：`RagTelemetry` 端口（contracts）+ noop / logger / fail-open 实现。脱敏在写入侧收口；`LoggerTelemetry` 依赖注入的日志端口而非 server logger；加源码扫描守卫禁止 `@opentelemetry`。                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-09-22 | **命名规则落地核查**：`knowledge-retrieval.md` 里 MCP 工具调用参数的 `project_id` → `projectId`（唯一一处真实错配）；其余 snake_case 命中经人工筛过，均为 SQL 列名 / DB 元数据 / 非 RAG 模块的既有文档。全工作区 typecheck / lint / test 全绿。                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-09-22 | **P2-5 完成**：`@apigent/rag/testing`（`hashEmbedder` / `memoryIndex` / `RecordingTelemetry` / fixture `ragDocumentSource`）；顺带在 `contracts/stages.ts` 落地 `Embedder` / `DenseIndex` 两个阶段端口（P0-4 的两条权限不变量在内存实现里先行落地）；`RagDocument` 补 `organizationId` 快照列。rag 测试 23 → 69 例。                                                                                                                                                                                                                                                                                                   |
| 2026-09-22 | **P2-6 完成**：`pipeline` 阶段注册表 + `createRagService()`。管线只 import 契约，阶段全部构造期注入（无隐藏单例）；装配期 fail-fast = P0-6 自检落点；降级（embedding 失败）与抛错（向量库不可用、摄取失败）的边界写进代码注释；空 scope 不打降级标记。rag 测试 69 → 94 例。**新增任务 P2-10**（P0-6 剩下的「包名加载 + 导出形状校验」，Phase 2 任务数 9 → 10）。                                                                                                                                                                                                                                                       |
| 2026-09-22 | **P2-7 完成**：端到端单测（Phase 2 退出条件）。三条中文查询 top1 全中、embedding 故障给降级标记而非 500、空召回与降级两条指标独立统计、重复索引幂等、span 属性不含 chunk 正文。顺带把 `DEFAULT_PIPELINE_CONFIG` 对齐 `DEFAULT_RAG_CONFIG.retrieval`。**转出待决策点**：「无相似度阈值导致 empty_rate 低估」记入 P4-4。rag 测试 94 → 101 例。                                                                                                                                                                                                                                                                           |
| 2026-09-22 | **P2-8 完成**：eslint 加 RAG 专用 `no-restricted-imports`（禁 `@apigent/server*` / 测试替身 / 适配器）；顶层 barrel 改为 `export type * from "./contracts"`（禁止客户端从顶层取值，值走 `/contracts`）；新增 `boundaries.test.ts` 钉住导出形态与依赖方向。已用临时违规文件取证两层都能拦住。rag 测试 101 → 106 例。                                                                                                                                                                                                                                                                                                    |
| 2026-09-22 | **P2-9 完成**：`@apigent/rag/stages`（`jiebaTokenizer` + `normalizeIdentifiers`）+ `Tokenizer` 端口。`cutForSearch` 有专测钉住（`cut` 会静默掉召回）；版本串 = 模式 + 库版本 + 词典标识 + 归一化版本，直接供 `tokenizer_version` 落库；jieba 惰性加载（词典不进非稀疏部署的内存）；词典是进程级配置，第二套直接抛错。新增依赖 `@node-rs/jieba@2.0.3`。rag 测试 106 → 122 例。                                                                                                                                                                                                                                          |
| 2026-09-22 | **P2-9 补充：`@node-rs/jieba` 版本精确固定**（`2.0.3`，非 `^2.0.3`）。理由：切分口径持久化在 `tokenizer_version` 里，版本变化 = 必须全量 REINDEX，因此升级要是显式 diff 而不是 `pnpm update` 的副作用；锁文件已冻结解析，这条是让升级动作**可见**。理由同时写进 `rag-package.md` §2.2 与 `jieba-tokenizer.ts` 文件头。                                                                                                                                                                                                                                                                                                 |
| 2026-09-22 | **P2-10 ① 完成（provider 包加载 + 启动期自检）**：`pipeline/loader.ts` 的 `loadStageFactory` / `preloadStageProviders`；内置命中不走加载路径、包名走动态 import + 导出形状校验（命名导出或 default）、加载成功即注册；文件路径五形态全部拒绝且不触发加载；自检只做「加载 + 形状校验」不实例化。rag 测试 122 → 138 例。**② 配置面放宽阻塞于「待确认」第 8 条**（`provider` 直接写包名 vs 显式 `provider: package` + `package:`）。                                                                                                                                                                                      |
| 2026-09-22 | **P2-10 ② 完成 + Phase 2 收官（10/10）**：定案 B —— 第三方 provider 写成显式判别 `provider: package` + `package` + `options`，挂进 `VectorStoreConfig` / `EmbeddingConfig` / `SearchStoreConfig` / `RerankerConfig` 四个 union；包名规则收敛到 `packages/core/src/config/provider-package.ts`，zod 与 `loadStageFactory` 共用（避免「校验通过但加载被拒」）。`defaults.ts` / `file-loader.ts` 无需改。core 测试 51 → 73 例。**新记缺口 P3-7**：P0-6 的 L0 整体替换（`rag.provider`）没有配置槽，Phase 3 任务数 6 → 7。                                                                                                 |
| 2026-09-22 | **约定：运行时会输出的字符串统一英文**（用户要求）。扫描全仓后改动：`@apigent/rag` 的 pipeline / stages / testing 替身里全部 `RagConfigError` / `RagIngestError` / `RagDependencyError` 文案；`packages/core/src/config/provider-package.ts` 的 zod 提示；`apps/platform` 一处 `apply_edit_draft` 校验错误；我新加的测试标题与断言消息（仓库基线本来就是英文标题，我引入的 55 条中文标题算偏差）。**保留中文的**：注释 / JSDoc、LLM 提示词与工具 `description`、中文检索语料与测试数据、守卫测试里的注释样本 —— 它们不是日志。约定写进 `CLAUDE.md` → Runtime output language（含例外清单与「为什么不加 lint 规则」）。 |
| 2026-09-22 | **示例里的第三方包名：保留 `@acme/…` 占位符，不改用 `@apigent/…`**（用户提问后核查）。理由：`@apigent/*` 是本仓库自己的 workspace 命名空间（八个包全部 `private: true`），写成示例会被读成「官方已提供」，而 `pnpm add` 会 404。改用 `@your-scope/…` 也可，但 `@acme` 是既有惯例且 P0-6 决策记录已用它。顺带**发现真问题并记为待确认第 9 条**：契约包发布不出去（`@apigent/rag` 私有），第三方 provider 包今天只能在 monorepo 内实现。同时修掉两处定案 B 遗留的文档漂移：L0 示例的旧形态、§12 表格里「任何 `provider` 字段」的旧说法。                                                                                 |
| 2026-09-22 | **新增 Phase 9「插件 SDK 对外发布」（5 个任务，非 V0 阻塞）** + 待确认第 9 条补 spike 实测：仓库无构建管线（所有包 `main` 指向 `.ts`、无 build 脚本、无打包器）；`tsc` 出契约+替身产物 104K、无原生依赖；**ESM 产物实测 `ERR_MODULE_NOT_FOUND`（extensionless 相对导入）、CJS 产物实测可加载** ⇒ 建议先走 CJS。另记一个内容缺口：插件作者要实现的工厂签名（`RagStageFactoryContext` 等）在 `pipeline/` 而非 `contracts/`，已列为 **P9-1**（建议提前到 Phase 3 之前，因为它影响 Phase 4/5 写 adapter 的 import 形态）。                                                                                                 |
| 2026-09-22 | **插件 SDK 定调：只记录、延后实现。** 方向取「对外提供 slim 契约包」（待确认 #9 的选项 B），但**本阶段不排期**（Phase 9 5 个任务保持未开始，标注 `已记录，延后实现`）。同时写下**延后代价**：P9-1 未做之前，Phase 4/5 的 adapter 会从 `pipeline/types` import 工厂签名，将来搬迁要一起改；以及**对外措辞约束**：P9-2 发出首个版本之前，文档不要承诺「`pnpm add` 就能写插件」。当前主线仍是 Phase 3（P3-1）。                                                                                                                                                                                                           |
| 2026-09-22 | **P3-1 完成（Phase 3 首个任务）**：迁移 `0005_rag_chunk_producer_identity.sql`（离线生成，**未执行**）—— 4 列（`embedding_model` / `embedding_dim` / `embedding_updated_at` / `tokenizer_version`）+ `knowledge_chunks_embedding_model_idx` + CHECK 约束「向量身份必须成套」。**取舍留痕**：`producer jsonb` 被否，理由是 rag 检索 SQL 手写（不过 drizzle 类型系统），JSON 键写错会**静默空召回**而列名写错 PG 当场报错；4 字段还被区分为「查询关键 2 个 / 纯审计 2 个」。顺手修正命令形式：`pnpm db:generate -- --name=…` → `pnpm db:generate --name=…`（pnpm 11 会透传 `--`）。                                      |
| 2026-09-22 | **P3-1 迁移已执行 + 验收**：本地 Docker Postgres（`localhost:5433/apigent`）迁移前 `knowledge_chunks` 0 行、5 个迁移；`pnpm db:migrate` → `6/6`；复核 4 列 / 索引 / CHECK 全部生效；约束负向验收（事务内 + SAVEPOINT + 回滚）三种形态全部符合设计。                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-09-22 | **P3-2 完成 + 迁移已执行（7/7）**：`search_vector` 改为由 `search_text` 派生的生成列（`to_tsvector('simple'::regconfig, …) STORED`），新增 `knowledge_chunks_tokenizer_identity_check`。**drizzle-kit 生成结果有两处必须手工修**：顺序错（先引用未建的 `search_text`）、`DROP COLUMN` 静默丢掉 GIN 索引（已显式重建，否则稀疏检索会悄悄退化）。动真库前先在事务里预演整条 DDL + 功能验证再回滚。同步修掉 `semantic-search.agent.md` §2.2 的三处过期表述，`rag-package.md` 新增 §12.1 部署前置条件。**转出开放项**：单输入丢了字段级权重 → 记入 P4-5。                                                                  |
| 2026-09-24 | **迁移历史重整（用户要求）**：P3-1 与 P3-2 的两条迁移合并为单条 `0005_rag_chunk_producer_identity_and_search_text.sql`（未上线 + `knowledge_chunks` 0 行）。合并后的 `when` 沿用旧 0006 时间戳 —— 读 drizzle 源码确认 migrator 只按 `created_at` 判定，所以已迁移的库自动跳过、只到 0004 的库与全新库正常执行。**验证**：临时库全新跑链路 `6/6` 且与主库表结构**完全一致**（21 列 / 8 索引 / 8 约束）；`db:check` 通过；再 `generate` 报 `No schema changes`。顺带修 `migrate.ts` 的误导输出（`7/6 migrations applied` → `up to date: journal has 6, database recorded 7 …`）。                                        |
