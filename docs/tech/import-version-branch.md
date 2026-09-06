# 版本化（branch）与导入模式重构 —— 开发技术方案

> **状态：V1 设计稿（2026-09-06），仅设计，不实现功能。**
> **关联：** 现有导入见 `packages/server/src/imports/`；版本服务见 `packages/server/src/versions/`；
> 上下文复用见 `packages/server/src/contexts/`；数据库 schema 见 `packages/server/src/db/schema/`。

---

## 1. 背景与问题

当前模型是**不可变快照 + 单指针**：

- 每次导入 = 生成一个新快照（`repo_versions` + 该版本下所有接口/模型/组件），`repositories.current_version_id` 指向最新。
- 一个仓库同时只有"一份当前 spec"；回滚 = 切回旧快照。

导致：

1. **多文件/多子系统导入会互相覆盖**：导入文件 B 后，A 的接口从当前视图消失（只留在旧快照里）。
2. **无法"版本=branch"并存**：无法同时有稳定的 v1 和生产中的 v2。
3. **不重复导入 / 复用**：未变实体每次都重新落库，无法复用。
4. **无单接口回滚**：只能整仓回滚。

### 目标（V1）

- **版本 = 命名分支（活线）**：多条并存、可 fork（基于他版或空树）、可切主分支、使用时可指定。
- **跨 commit 复用**：未变实体跨多个 commit 复用**同一份定义**（内容行被多个 commit 引用，不复制）。
- **导入两种模式**：
  - **全量更新（合并/同步）**：文件 = 整仓真相，复用未变 + 增/改 + 缺席删除。
  - **增量更新（保留）**：文件 = 某部分，只增/改，**不删**。
- **手动删除**：删除接口/模型/组件产生新快照（git `rm` + commit）。

**V2（本次不实现）**：增量·清理（按源删）+ source 归属 + 跨源冲突。

---

## 2. 概念模型（git 类比）

| Git | Apigent | 说明 |
|---|---|---|
| Branch | `versions`（活线） | 用户眼中的"版本"，v1/v2/main |
| Commit | `version_commits`（快照） | 不可变历史，带 `parent_commit_id` |
| Path | `identity_key` | `operationId ?? METHOD:PATH`（接口）/ `name`（模型）/ `kind::name`（组件） |
| Blob | `endpoints` / `data_models` / `components`（版本无关内容块） | 内容寻址，`content_hash` 去重 |
| Tree | `version_entity_links` | commit 到 identity 到 blob |
| HEAD | 主分支头 / 指定版本 | "当前"= 主分支 `head_commit_id`，使用时可显式指定 |

关键原则：

- **版本（branch）是活线**：可由 `parent_version_id` 从另一版本 fork，或空树新建；内部由 commit 记录历史。
- **内容块版本无关**：内容行不携带 `commit_id`；`version_entity_links` 记录"哪个 commit 用哪个 blob"，因此**未变实体被多个 commit 引用，实现真复用**，而不是每 commit 复制一份。
- **endpoint 与 endpoint_responses 是一个逻辑单元**：不会独立修改 response，hash 与对比按整体处理。
- **每行 response 有 hash**：对比/概览用 hash 列表，不加载完整 schema。
- **diff 不需要共同祖先**：直接比较两个 commit 的内容（`identity_key` + `content_hash`），无论是否同源；只有 merge（V1 不做）才需要 merge base。

---

## 3. 表结构设计

> ID 统一用 `generateId(prefix)`，格式 `前缀_10位`（见 `packages/server/src/id.ts`）。
> 需要新增 id 前缀：`commit: cmt_`；其余复用 `ver_ / api_ / data_ / comp_ / rsp_`。
> 内容表复用为**版本无关的内容块（blob）**：加 `content_hash`（按 `repo_id` 去重）、去掉对单一 version 的绑定；`version_entity_links` 承担"commit → identity → blob"。

### 3.1 `versions` —— 活线（branch）

```ts
versions
  id                text PK        // ver_
  repo_id           text FK        // repositories
  name              text NOT NULL  // v1 / v2 / main
  parent_version_id text NULL      // 基于哪条线 fork；空树新建为 NULL
  head_commit_id    text NULL      // 当前最新快照；空树分支 = 指向"空 commit"（见 §5.3）
  is_default        boolean NOT NULL DEFAULT false
  created_at        timestamp
  UNIQUE (repo_id, name)
  UNIQUE (repo_id) WHERE is_default   // 唯一主分支
```

> **新建仓库即创建默认 `main` 版本**（`name='main'`, `is_default=true`, `head_commit_id=NULL`，首个导入前无 commit），保证每仓始终有一条基线、无需在代码里处理"无版本"空态。用户**开启"多版本管理"**后才允许再新建/切换额外分支，并在 UI 层显隐（默认隐藏）。

### 3.2 `version_commits` —— 快照（commit）

```ts
version_commits
  id                text PK        // cmt_
  repo_id           text FK        // repositories
  version_id        text FK        // versions
  parent_commit_id  text NULL      // FK version_commits.id；父快照，用于历史回溯/回滚
  label             text NULL      // 展示名（导入序号/描述）
  spec_title        text NULL      // 本次导入文件 info.title
  spec_version      text NULL      // 本次导入文件 info.version
  description       text NULL      // 本次导入文件 info.description
  spec_storage_path text NULL      // 导入文件落盘路径；空树/手动删除等无文件的 commit 可为 NULL
  source            text NULL      // import | manual | ...
  merge_source      jsonb NULL     // merge 来源：{ source_branch_id, source_head_commit_id, base_commit_id }
  tag_meta          jsonb NULL     // tag 名称 → 描述/排序（modules 派生用）
  change_summary    jsonb NULL     // { added: [identity_key], updated: [identity_key], removed: [identity_key] }
  created_at        timestamp
  INDEX (repo_id, version_id)
  INDEX (parent_commit_id)
```

> `change_summary` 是可选增强：把"这个 commit 引入了哪些增/改/删"显式落库，实现"某次导入删了某接口"的可查询/可审计，不必每次 diff 反推。
>
> ⚠️ `version_id` 仅表示"这个 commit 出自哪条线"（溯源）；**某版本的历史/回滚必须沿 `parent_commit_id` 链走**（fork 后 v2 的头会先指向 v1 的 commit，那个 commit 的 `version_id` 是 v1）。不要用 `WHERE version_id = :v` 列历史。
>
> ⚠️ 两个"父"概念不同：`versions.parent_version_id` = 分支 fork 自哪条线；`version_commits.parent_commit_id` = 前一个 commit。
>
> ⚠️ merge 用**单父**：目标分支 `head_commit_id` 保持线性，merge 只产出一个新 commit（`parent_commit_id = 目标分支前一个 commit`），并用 `merge_source` 记录来源；**不将源分支的 commit 历史并入目标分支**（在目标分支上不可见源分支的 commit 链）。

### 3.3 `version_entity_links` —— 统一树

```ts
version_entity_links
  commit_id    text NOT NULL   // FK version_commits
  entity_type  text NOT NULL   // endpoint | data_model | component
  identity_key text NOT NULL   // 冗余存储，省 join 现算；diff 用
  entity_id    text NOT NULL   // 指向 endpoints / data_models / components .id（blob）
  PRIMARY KEY (commit_id, entity_type, identity_key)
  INDEX (commit_id, entity_type)
  CHECK (entity_type IN ('endpoint','data_model','component'))
```

> `entity_id` / `identity_key` 是多态引用，无法建单一外键；靠 `entity_type` + 应用层校验 + 单测保证。

### 3.4 `endpoints` —— 接口内容块（blob，复用现有表，版本无关）

```ts
endpoints
  id                   text PK      // api_
  repo_id              text FK      // repositories
  content_hash         text NOT NULL // sha256(规范化 head + sorted responses[].hash)
  operation_id         text NULL
  method               text NOT NULL
  path                 text NOT NULL
  summary              text NULL
  description          text NULL
  deprecated           boolean NOT NULL DEFAULT false
  request_content_type text NULL
  request_schema       jsonb NULL      // SchemaRef {schema,ref,unresolved}
  parameters           jsonb NOT NULL  // ParameterDef[]
  tags                 jsonb NOT NULL  // string[]
  security             jsonb NOT NULL  // SecurityRequirement[]
  responses_meta       jsonb NOT NULL  // [{hash, status_code, content_type}] 廉价索引
  created_at           timestamp
  UNIQUE (repo_id, content_hash)
  -- 原 version_id 移除；原 UNIQUE(version_id, method, path) 移除，改由 version_entity_links 表达"哪个 commit 用哪个 blob"
```

### 3.5 `endpoint_responses` —— 接口响应（检索/详情，挂 blob）

```ts
endpoint_responses
  id           text PK       // rsp_
  repo_id      text FK       // repositories
  endpoint_id  text FK       // endpoints.id（blob）
  resp_hash    text NOT NULL // sha256(规范化 response)
  status_code  text NOT NULL
  content_type text NULL
  description  text NULL
  headers      jsonb NOT NULL DEFAULT []
  schema       jsonb NULL      // SchemaRef {schema,ref,unresolved}
  is_error     boolean NOT NULL DEFAULT false
  UNIQUE (endpoint_id, status_code, content_type)
  INDEX (status_code)
  INDEX (content_type)
```

### 3.6 `data_models` / `components` —— 内容块（blob，版本无关）

```ts
data_models
  id           text PK      // data_
  repo_id      text FK
  content_hash text NOT NULL
  name         text NOT NULL
  type         text NULL    // schema_type
  schema_raw   jsonb NOT NULL // { type, properties, required }
  description  text NULL
  UNIQUE (repo_id, content_hash)
  -- 原 version_id 移除

components
  id           text PK      // comp_
  repo_id      text FK
  content_hash text NOT NULL
  kind         text NOT NULL
  name         text NOT NULL
  def_type     text NULL
  payload      jsonb NOT NULL
  description  text NULL
  UNIQUE (repo_id, content_hash)
  -- 原 version_id 移除
```

### 3.7 `repositories` 调整

- 移除单一 `current_version_id`（项目未上线、无历史包袱，直接移除，无需兼容视图）。
- "当前版本"语义改为：`versions.is_default` 的 `head_commit_id`；使用时可显式传 `version_id`。

---

## 4. Hash 生成规范

统一用 `stableStringify`（对象 key 排序后序列化）+ SHA-256。

### 4.1 规范化规则

- stable stringify（递归，key 排序）。
- 数组排序：`parameters` 按 `(in, name)`；`responses` 按 `(status_code, content_type)`；`tags` 排序。
- 文本归一：`method` 大写+trim；字符串 trim。
- `null` / `undefined` 归一。
- **$ref：hash 用"解析后的有效内容"，存储保留原始 ref**（尊重 OpenAPI 结构）。

### 4.2 接口 endpoint hash

```text
{
  method, path, operation_id, summary, description, deprecated,
  request_content_type, request_schema,   // SchemaRef 的 schema（有效内容）
  parameters: [{ name, in, required, description, schema, example }],
  tags: [...],                            // 排序
  security: [...],
  responses: [ { hash, status_code, content_type } ]  // hash 列表，排序
}
```

`content_hash = sha256( stableStringify(该对象) )`。

> 复用现有 `contexts/fingerprint.ts` 的 `computeEndpointFingerprint`（已覆盖 operationId/method/path/summary/desc/parameters/requestSchema/responses），**补充 requestContentType / deprecated / tags / security** 即可。

### 4.3 数据模型 hash

```text
{ name, type, schema_raw: { type, properties, required }, description }
```

### 4.4 组件 hash

```text
{ kind, name, def_type, payload, description }
```

### 4.5 response 行 hash

```text
{ status_code, content_type, description, headers, schema, is_error }
```

`resp_hash = sha256( stableStringify(该对象) )`。

---

## 5. 导入算法（V1）

统一框架：**打开新 `version_commits` → 解析 → 对每个实体算 `content_hash` → 复用或新建 blob → 写 `version_entity_links` → 更新版本 `head_commit_id`**。

> **原子性**：创建 `version_commits` + 写 `version_entity_links` + 更新 `head_commit_id` 应在一个数据库事务内完成；失败则整体回滚，不留半成品 commit、`head_commit_id` 不变。尽量复用现有 `imports/executor.ts` 的 `db.transaction` 模式。

### 5.1 全量更新（合并/同步）

```text
输入: repo, 目标 version_id, 文件内容
1. 解析 → [{ identity_key, endpoint_def }, ...] + schemas + components
2. 新建 commit C（记录 spec_title/version/description/storage_path/tag_meta）
3. 遍历文件实体：
   content_hash → 命中已有 blob（repo_id, content_hash）? 复用 : 新建 endpoints/data_models/components
   upsert endpoint_responses（按 resp_hash 归并到 blob）
   写 link(C, entity_type, identity_key, blob.id)
4. 删除（整仓）：当前 head commit（即本提交的父 commit）的 links 里 identity_key 不在文件实体集 → 不写入 C
5. （可选）计算 change_summary { added, updated, removed } 并写 C
6. version.head_commit_id = C.id
```

### 5.2 增量更新（保留）

```text
1. 解析 → 实体列表
2. C = 拷贝父 commit 的 links
3. 遍历文件实体：
   复用/新建 blob，upsert link（identity 存在 → 更新指向；不存在 → 新增）
   # 父 commit 有、文件里没有的 → 保留（不删）
4. （可选）计算 change_summary（不含 removed）并写 C
5. version.head_commit_id = C.id
```

### 5.3 空树新建

新版本 `head_commit_id` 指向一个空 commit（无 links），即"全空分支"。

### 5.4 新建分支

- **基于其他版本**：新 `versions` 行 `head_commit_id = 源版本 head`，`parent_version_id = 源版本 id`。
- **空树**：`head_commit_id = 空 commit`，`parent_version_id = NULL`。

---

## 6. 读取路径

- **列接口（某版本/当前）**：`versions` → `head_commit_id` → `version_entity_links`（filter type, index on commit_id）→ `endpoints`（blob）→ （可选）`endpoint_responses`。
- **接口详情**：同上 + responses 按需加载。
- **版本列表/统计**：count `version_entity_links` per commit（按 type 分别 count）。
- **版本对比**：取两 commit 的 links → 按 `identity_key` 分组、比 `entity_id` 指向 blob 的 `content_hash`：同 hash = 未变；不同 = 修改；单边 = 加/删。变更接口比较 `responses_meta` 的 hash 列表定位变化行；breaking 规则复用 `diff/engine.ts` 并新纳入 responses。**不需要共同祖先。**
- **回滚（R1，移指针）**：沿 `version_commits.parent_commit_id` 从该版本 `head_commit_id` 往回走 N 步，把 `versions.head_commit_id` 指回目标 commit；目标 commit 的 links/blob 完整（不可变），即"当前状态"回到该快照。中间被跳过的 commit 仍存在（可再 forward / 找回），只是不再是 head。
- **切主分支**：改 `versions.is_default`。

---

## 7. 手动删除

- 删除接口/模型/组件 → 在目标 commit 的 links 里去掉该 `identity_key` 的 link → 新 commit → 更新 head。
- 删除写入 `operation_log_details`（`change_type='removed'` + `from/to`）。
- 若启用 `change_summary`，该完成同样写入 `removed`。

---

## 8. 数据库重建（未上线，无迁移负担）

> 项目未上线、无历史包袱：落地时**清库重建**（用 Drizzle 重新生成 migration）。旧表
> （`repo_versions` / `endpoints` / `data_models` / `components` / `endpoint_responses` / `modules` / `endpoint_modules`）
> 由新结构**整体替代**，无需存量迁移脚本、双写或兼容视图。代码直接按新模型写，不兼容旧数据。

新 schema 重建要点：

- 建 `versions`（新建仓库即创建默认 `main`，见 §3.1）。
- 建 `version_commits`（含 `parent_commit_id`、`merge_source`、`change_summary`）。
- 建 `version_entity_links`。
- `endpoints` / `data_models` / `components` 去掉 `version_id`，加 `content_hash`；接口再加 `tags` / `security` / `responses_meta`，去 `UNIQUE(version_id, method, path)`。
- `endpoint_responses` 挂 `endpoints.id`（blob），去 `endpoint_id` 的版本语义，加 `resp_hash`。
- 弃用 `modules` / `endpoint_modules`（改为从 `endpoints.tags` + `version_commits.tag_meta` 派生）。
- `business_contexts` / `knowledge_chunks` / `endpoint_relationships` 的 `version_id` 改为指向 `version_commits.id`；`endpoint_id` 指向 blob。

---

## 9. 前端 / API 契约变化

- **版本页**：branch 概念（列表、新建：基于他版/空树、设为默认/主、指定使用）。
- **多版本入口默认隐藏**：未开启"多版本管理"时不展示版本/分支列表；开启后才显示版本列表、新建分支、切主、指定使用。
- **导入对话框**：选模式（全量更新 / 增量更新），渲染预览 `新增 / 更新 / 保留`（V1 无删除/冲突）。
- **指定使用**：接口可选 `version_id`；默认用主版本。
- **手动删除入口**：接口/模型/组件列表项删除。

---

## 10. 分阶段落地

| 阶段 | 范围 | 内容 |
|---|---|---|
| **Phase A** | 接口 | `versions/version_commits/version_entity_links` + `endpoints`（作为 blob）/`endpoint_responses`（加 resp_hash）；导入两模式；手动删除；版本对比；接口读取路径 |
| **Phase B** | 模型/组件 | `data_models` / `components` 同构改造为 blob |
| **Phase C / V2** | 归属与清理 | `source` 归属 + 增量·清理（按源删）+ 跨源冲突 |

---

## 11. 风险与权衡

- **FK 弱化**：`version_entity_links` 的多态列无外键，靠应用层 + 测试。
- **读取路径/导入重写面大**：`versions/imports/contexts/repos/diff/frontend` 都要改。
- **diff 需纳入 responses**：否则响应变化无法识别为"修改"。
- **无存量迁移**：项目未上线，清库重建即可；但 `business_contexts` / `knowledge_chunks` / `endpoint_relationships` 的引用列也要一并调整（`version_id` → `version_commits.id`，`endpoint_id` → blob）。
- **全量更新 = 整仓真相**：若仓库由多个源合并而成，用单源文件做"全量更新"会误删其它源的实体；多源仓库请用"增量更新"，全量只用于真正代表整仓的文件。
- **已知限制**：接口**改名**（identity 变化）会被当作"删除+新增"，`business_contexts` 指纹复用的上下文不会带过来（需后续做改名/重命名映射）。

---

## 12. 已定 & 待定

**已定：**

- 版本 = branch（versions），快照 = `version_commits`（带 `parent_commit_id`）；fork = 指向源版本 head；空树 = 空 commit。
- **新建仓库即创建默认 `main` 版本**（`is_default=true`）；"多版本管理"为独立开关，控制额外分支的新增/切换，并在 UI 显隐。
- 主分支 = `versions.is_default`（每仓一个）；使用时可指定 `version_id`。
- **内容块版本无关 + `version_entity_links` 树**：未变实体被多个 commit 引用（**真复用**，不复制）；内容表复用为 blob，不新增 `_revisions` / `_identities` 表。
- 每行 response 有 `resp_hash`；endpoint 持 `responses_meta`（hash 列表，无内容）用于廉价对比。
- endpoint 与 responses 一体（hash 与对比按整体）。
- diff **不需要共同祖先**；merge 才需要（V1 不做）。
- `change_summary`（可选增强）显式记录 commit 的 added/updated/removed，实现"某次导入删了某接口"的可查询留痕。
- modules（tag 分组）**派生**，不单独成 blob；tag 描述放 `version_commits.tag_meta`。
- 不把 operation 内联 responses 搬进 components；components 只存源文件真实声明。
- `business_contexts` 承载 endpoint 级业务数据，用指纹复用跨版本跟随。
- 回滚用 **R1（移指针）**；切主改 `is_default`。
- V1 无自动删除（全量更新除外）；删除走手动；`增量·清理` 放 V2。

**待定（实现前确认）：**

- `version_commits.label` 倾向去掉（可由 `spec_version` + `source` + `created_at` 承担）；若版本历史列表要"人类可读的提交说明"再保留。
- ~~response 内容寻址共享~~：**已定不做**——response 按接口独立定义，只随同一接口 blob 跨 commit 复用，绝不跨接口共享。
- `source_key`：**Phase A 不预留**，V2 做"增量·清理"时再按需加列。

---

## 13. Merge（V2+，本期不做）

> 仅做方向与数据结构预留，不实现。

### 语义

- merge = 在**目标分支**上新建一个 commit（`parent_commit_id = 目标分支前一个 commit`，单父，历史保持线性）。
- 该 commit 写 `merge_source = { source_branch_id, source_head_commit_id, base_commit_id }`。
- **不记录源分支的 commit 历史**；源分支自身链独立保留，但不并进目标分支血缘。

### 算法（必做，否则 merge 无法计算）

1. 求 `base = LCA(目标分支 head, 源分支 head)`（沿 `parent_commit_id` 链找共同祖先；无共同祖先 → base = 空树，merge 近似 union）。
2. 算 `base→A`、`base→B` 的 per-identity 变更（`identity_key` + `content_hash`）。
3. 三方判定每个 identity：
   - 仅一侧变 → 用该侧
   - 都未变 → 用 base
   - 都变且相同 → 相同
   - 都变且不同 → **冲突**
   - 一侧删一侧未动 → 删（或按策略保留）
   - 一侧删一侧改/都删 → 冲突
4. 组合出 merge 树；写新 commit（目标分支）+ `merge_source` + （可选）`change_summary`。
5. 冲突处理：per identity 选 A/B/手改；冲突清单落库；前端合并处理 UI；`operation_logs` 记 merge 事件。

### 已知限制 / 取舍

- **历史线性，不可见源分支 commit 链**；只能通过 `merge_source` 溯源。
- **重复 merge**：源分支未获得目标分支的 merge commit → base 仍为原始 fork 点，重新算源分支全量 delta；若两侧均动，冲突可能反复（V2/V3 可优化"增量合并基点"）。
- **回滚**：目标分支仍线性，R1 回滚到 merge 前即回到合并前状态。
- **rebase 不做**：会改写历史、与"不可变可追溯"冲突，价值低于 merge。
- **删除策略**：merge 默认"union + 冲突"，不因一侧缺席而删；"一侧删一侧未动"需明确策略（默认询问 / 保守保留）。
