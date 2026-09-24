-- 0005 — RAG chunk 的生产者身份 + 稀疏检索文本（P3-1 与 P3-2 合并）
--
-- 为什么合并：P3-1（生产者身份列）与 P3-2（search_text / search_vector 形态）
-- 是同一批「为 RAG 摄取准备 knowledge_chunks」的变更，都在预发布阶段完成、
-- 表内 0 行。按「未上线可重整迁移」的原则并成一个，避免把一次性的演进过程
-- 留在迁移历史里。
--
-- 内容：
--   1. 生产者身份（P0-2 / P0-3）：`embedding_model` / `embedding_dim` /
--      `embedding_updated_at` / `tokenizer_version` —— 记录「这行数据是谁产的」。
--      检索按当前模型过滤，不匹配的行视为待重索引、不参与召回 ——
--      新旧向量混表检索是**静默劣化**，必须由结构排除。
--   2. 稀疏检索文本（P0-3）：`search_text` 由应用侧切词写入（jieba `cutForSearch`
--      + 标识符归一化），`search_vector` 由它**确定性派生**为生成列 ——
--      既没有「正文写完、向量还没更新」的窗口期，又能 `select search_text`
--      直接看到切成了什么。用 `simple` 而不是 `english`：中文本来就不靠 PG 的
--      parser，而 english 的 stemming 会改动英文标识符。一参形式
--      `to_tsvector(text)` 依赖 GUC 且是 STABLE，不能用于生成列。
--   3. 两条身份约束：有向量就必须知道型号 / 维度 / 时间（
--      `knowledge_chunks_embedding_identity_check`）；切了词就必须知道分词器版本
--      （`knowledge_chunks_tokenizer_identity_check`）。
--
-- ⚠️ 本文件在 drizzle-kit 生成结果上做了两处**手工修正**（原样跑会坏）：
--   1. **顺序**：生成结果把 `ADD COLUMN search_vector`（表达式引用 `search_text`）
--      排在 `ADD COLUMN search_text` 之前 → PG 报 column "search_text" does not exist。
--   2. **GIN 索引**：`DROP COLUMN search_vector` 会连带删掉
--      `knowledge_chunks_search_vector_gin_idx`，而 drizzle 认为该索引没变、
--      不会重建 ⇒ 稀疏检索会**静默退化成顺序扫描**，且快照与库从此不一致
--      （后续 generate 也看不出来）。所以这里显式重建。
--
-- 表当前 0 行，删列重建零成本、无需回填。
--
-- 记账：journal 里本条目的 `when` 沿用被合并的旧 0006 的时间戳 —— migrator 只按
-- `created_at` 判定已应用，这样「跑过旧 0005 + 0006」的库会被跳过（schema 已经
-- 与合并结果一致），而只到 0004 的库 / 全新库会正常执行这一条。

ALTER TABLE "knowledge_chunks" ADD COLUMN "embedding_model" varchar(128);--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "embedding_dim" integer;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "embedding_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "tokenizer_version" varchar(128);--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "search_text" text;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" DROP COLUMN "search_vector";--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, "search_text")) STORED;--> statement-breakpoint
CREATE INDEX "knowledge_chunks_embedding_model_idx" ON "knowledge_chunks" USING btree ("embedding_model");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_search_vector_gin_idx" ON "knowledge_chunks" USING gin ("search_vector");--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_embedding_identity_check" CHECK (("knowledge_chunks"."embedding" IS NULL) = ("knowledge_chunks"."embedding_model" IS NULL)
        AND ("knowledge_chunks"."embedding" IS NULL) = ("knowledge_chunks"."embedding_dim" IS NULL)
        AND ("knowledge_chunks"."embedding" IS NULL) = ("knowledge_chunks"."embedding_updated_at" IS NULL));--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_tokenizer_identity_check" CHECK (("knowledge_chunks"."search_text" IS NULL) = ("knowledge_chunks"."tokenizer_version" IS NULL));
