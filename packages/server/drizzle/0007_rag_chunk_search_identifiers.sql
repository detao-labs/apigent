-- 0007 — 字段级权重：search_identifiers + 两段式 search_vector（P4-5 方案 2）
--
-- 背景（P3-2 转来的开放项）：0005 里 `search_vector` 只由 `search_text` 一个输入
-- 派生，于是「method / path 这类标识符权重更高」的设计**在结构上无法表达** ——
-- `ts_rank` 的权重来自 tsvector 的 weight label（A/B/C/D），单输入只能是同一个
-- label。两条候选路（见 rag-package-tasks.md P4-5）：① 标识符在 search_text 里
-- 重复做词频加权；② 单开一列标识符，生成表达式按 label 拼接。**用户定案选 ②**：
-- 词频加权做不到「标识符 ≫ 正文」的区分度（长文档的正文词频会把它淹没），而
-- 单列换来的是可解释、可用 `ts_rank` 直接验证的排序行为。
--
-- 内容：
--   1. 新增 `search_identifiers text` —— 归一化后的标识符词元（应用侧写入）。
--   2. `search_vector` 生成表达式改为两段拼接：
--        setweight(to_tsvector('simple', coalesce(search_text,        '')), 'C') ||
--        setweight(to_tsvector('simple', coalesce(search_identifiers, '')), 'A')
--      `coalesce` 不是防御性代码：`tsvector || tsvector` 是 STRICT 的，任一操作数为
--      NULL 会让**整列**变 NULL —— 稀疏检索会静默全灭（不报错、只是永远 0 条）。
--   3. `knowledge_chunks_tokenizer_identity_check` 追加「有标识符必须有正文」——
--      标识符与正文同写同空，写入路径只有一条（@apigent/rag 稀疏索引适配器）。
--
-- ⚠️ 本文件在 drizzle-kit 生成结果上做了两处**手工修正**（原样跑会坏）：
--   1. **顺序**：生成结果把 `ADD COLUMN search_vector`（表达式引用 search_identifiers）
--      排在 `ADD COLUMN search_identifiers` 之前 → PG 报 column "search_identifiers"
--      does not exist。
--   2. **GIN 索引**：`DROP COLUMN search_vector` 会连带删掉
--      `knowledge_chunks_search_vector_gin_idx`，而 drizzle 认为该索引没变、
--      不会重建 ⇒ 稀疏检索会**静默退化成顺序扫描**，且快照与库从此不一致
--      （后续 generate 也看不出来）。所以这里显式重建。
--
-- 表当前 0 行，删列重建零成本、无需回填。

ALTER TABLE "knowledge_chunks" DROP CONSTRAINT "knowledge_chunks_tokenizer_identity_check";--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "search_identifiers" text;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" drop column "search_vector";--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple'::regconfig, coalesce("search_text", '')), 'C') || setweight(to_tsvector('simple'::regconfig, coalesce("search_identifiers", '')), 'A')) STORED;--> statement-breakpoint
CREATE INDEX "knowledge_chunks_search_vector_gin_idx" ON "knowledge_chunks" USING gin ("search_vector");--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_tokenizer_identity_check" CHECK (("knowledge_chunks"."search_text" IS NULL) = ("knowledge_chunks"."tokenizer_version" IS NULL)
        AND ("knowledge_chunks"."search_identifiers" IS NULL OR "knowledge_chunks"."search_text" IS NOT NULL));
