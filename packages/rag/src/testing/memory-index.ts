// ═══════════════════════════════════════════════════════════════════
// Testing — memoryIndex（内存稠密索引）
// ═══════════════════════════════════════════════════════════════════
//
// 与 `hashEmbedder` 配对，让「写入 → 检索 → 排序」在无 DB、无网络的 CI 里可跑。
//
// 它同时是 **P0-4 两条权限不变量的早期落地**（正式的钉死在 P3-4 / P4-4 的 SQL）：
//
//   ① 权限打在 chunk 上：`WHERE record.repositoryId ∈ scope.repositoryIds`
//      —— 空数组 = 无权限 = 零结果，不存在「不传即全库」。
//   ② 版本打在 link 上：`record.commitIds ∩ scope.commitIds ≠ ∅` **只做收窄**，
//      不承担任何权限语义。
//
// 两者与 `filters` 在**同一个循环里 AND，并且都在排序与 limit 之前** ——
// 结构上不可能退化成「取回后再过滤」，否则越权结果会先进候选集。
//
// `scope.projectId` 有意**不在这里过滤**：按双层规则，Project 成员身份只决定
// 「能否看到项目」并据此收窄 repo 集合（`resolveSearchScope()`，P5-4 的职责），
// 内容访问仍走 repo 权限。索引层再按 project 过滤等于长出第二套授权模型。
// ═══════════════════════════════════════════════════════════════════

import {
  RagConfigError,
  type DenseChunkRecord,
  type DenseHit,
  type DenseIndex,
  type DenseQuery,
  type DenseUnlinkSelector,
} from "../contracts";

/** 内存稠密索引。每条记录 = 一行 chunk + 它的 link 集合。 */
export function memoryIndex(): DenseIndex {
  return new MemoryIndex();
}

class MemoryIndex implements DenseIndex {
  /** key = `${repositoryId}\u0000${chunkKey}` —— 与 P0-4 的唯一键同构 */
  private readonly records = new Map<string, DenseChunkRecord>();
  /** 索引维度：由第一条写入的记录确定，之后不允许混维度（P0-2） */
  private dim?: number;

  async upsert(records: DenseChunkRecord[]): Promise<void> {
    for (const record of records) {
      const vector = [...record.vector];
      this.assertDimension(record, vector.length);

      const key = recordKey(record.repositoryId, record.chunkKey);
      const existing = this.records.get(key);
      this.records.set(key, {
        ...record,
        vector,
        // 快照列：新记录没带组织时沿用旧值，避免 upsert 把收窄依据抹掉
        organizationId: record.organizationId ?? existing?.organizationId,
        // 同一内容可能同时被新旧 commit 引用（P0-4：内容寻址 + links）
        commitIds: merge(existing?.commitIds ?? [], record.commitIds),
      });
    }
  }

  async search(query: DenseQuery): Promise<DenseHit[]> {
    // 空集合 = 无权限。用 Set 而不是「if 有值才过滤」，是为了让这条不变量
    // 在代码形态上就无法退化。
    const accessible = new Set(query.scope.repositoryIds);
    const wantedCommits = query.scope.commitIds;
    const hits: DenseHit[] = [];

    for (const record of this.records.values()) {
      // ① 权限（chunk 维度）
      if (!accessible.has(record.repositoryId)) continue;
      // 组织收窄 —— chunk 上的 organization_id 快照列
      if (query.scope.organizationId && record.organizationId !== query.scope.organizationId) {
        continue;
      }
      // ② 版本收窄（link 维度，纯收窄）
      if (wantedCommits && !wantedCommits.some((commitId) => record.commitIds.includes(commitId))) {
        continue;
      }
      // P0-2：只召回当前模型产出的向量，不匹配的行视为待重索引
      if (record.embeddingModel !== query.embeddingModel) continue;
      if (!matchesFilters(record, query.filters)) continue;

      hits.push({
        chunkKey: record.chunkKey,
        repositoryId: record.repositoryId,
        level: record.level,
        lang: record.lang,
        text: record.text,
        fields: record.fields,
        metadata: record.metadata,
        score: cosine(query.vector, record.vector),
      });
    }

    // 同分时按 chunkKey 排序 —— 否则 Map 的插入顺序会泄漏进结果，
    // 让「同样的输入得到同样的排名」这条评测前提不成立。
    hits.sort((a, b) => b.score - a.score || compare(a.chunkKey, b.chunkKey));
    return hits.slice(0, Math.max(0, query.limit));
  }

  async unlink(selector: DenseUnlinkSelector): Promise<number> {
    const { repositoryId, commitId, chunkKeys } = selector;
    const wanted = chunkKeys ? new Set(chunkKeys) : undefined;
    let affected = 0;

    for (const [key, record] of this.records) {
      if (record.repositoryId !== repositoryId) continue;
      if (!record.commitIds.includes(commitId)) continue;
      if (wanted && !wanted.has(record.chunkKey)) continue;

      const remaining = record.commitIds.filter((id) => id !== commitId);
      if (remaining.length === 0) {
        // GC：没有任何 commit 引用了才真的删除（P0-4 的防误删规则）
        this.records.delete(key);
      } else {
        this.records.set(key, { ...record, commitIds: remaining });
      }
      affected += 1;
    }

    if (this.records.size === 0) this.dim = undefined;
    return affected;
  }

  async dropRepository(repositoryId: string): Promise<number> {
    let removed = 0;
    for (const [key, record] of this.records) {
      if (record.repositoryId !== repositoryId) continue;
      this.records.delete(key);
      removed += 1;
    }
    if (this.records.size === 0) this.dim = undefined;
    return removed;
  }

  async size(): Promise<number> {
    return this.records.size;
  }

  private assertDimension(record: DenseChunkRecord, length: number): void {
    if (length === 0) {
      throw new RagConfigError(
        `memoryIndex: empty vector for ${record.repositoryId}/${record.chunkKey}`,
      );
    }
    if (this.dim === undefined) {
      this.dim = length;
      return;
    }
    if (length !== this.dim) {
      // P0-2：不允许混维度。换模型 / 换维度 = 全量重索引，不是运行时切换。
      throw new RagConfigError(
        `memoryIndex: vector dimension mismatch (index is ${this.dim}-dimensional, ` +
          `${record.repositoryId}/${record.chunkKey} is ${length}-dimensional); ` +
          "switching embedding models requires a full reindex",
      );
    }
  }
}

// ───────────────────────────────────────────────────────────────────
// 内部工具
// ───────────────────────────────────────────────────────────────────

function recordKey(repositoryId: string, chunkKey: string): string {
  return `${repositoryId}\u0000${chunkKey}`;
}

function merge(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

function compare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new RagConfigError(
      `memoryIndex: query vector is ${a.length}-dimensional but the index is ${b.length}-dimensional`,
    );
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** 结构化过滤：与权限过滤是**两层独立 AND**（各自都能单独把记录排除）。 */
function matchesFilters(record: DenseChunkRecord, filters: DenseQuery["filters"]): boolean {
  if (!filters) return true;

  if (filters.methods?.length) {
    const method = record.fields?.method?.toUpperCase();
    if (!method || !filters.methods.some((wanted) => wanted.toUpperCase() === method)) return false;
  }

  if (filters.tags?.length) {
    const tags = (record.fields?.tags ?? []).map((tag) => tag.toLowerCase());
    if (!filters.tags.some((wanted) => tags.includes(wanted.toLowerCase()))) return false;
  }

  if (filters.pathPrefix && !(record.fields?.path ?? "").startsWith(filters.pathPrefix)) {
    return false;
  }

  return true;
}
