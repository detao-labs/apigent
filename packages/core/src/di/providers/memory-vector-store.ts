// ═══════════════════════════════════════════════════════════════════
// Memory Vector Store — Dev Fallback
// ═══════════════════════════════════════════════════════════════════

import type { VectorStore, VectorRecord, SearchResult, SearchOptions } from "../../types";

export class MemoryVectorStore implements VectorStore {
  private records: Map<string, VectorRecord> = new Map();

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  async search(embedding: number[], options?: SearchOptions): Promise<SearchResult[]> {
    const topK = options?.topK ?? 10;
    const results: SearchResult[] = [];

    for (const [id, record] of this.records) {
      const score = this.cosineSimilarity(embedding, record.embedding);
      results.push({ id, score, metadata: record.metadata });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  async insert(records: VectorRecord[]): Promise<void> {
    for (const record of records) {
      this.records.set(record.id, record);
    }
  }

  async delete(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.records.delete(id);
    }
  }

  async count(): Promise<number> {
    return this.records.size;
  }
}
