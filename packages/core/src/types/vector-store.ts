// ═══════════════════════════════════════════════════════════════════
// Vector Store Interface
// ═══════════════════════════════════════════════════════════════════

export interface SearchResult {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface VectorRecord {
  id: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  topK?: number;
  filter?: Record<string, unknown>;
}

export interface VectorStore {
  /** Search for similar vectors */
  search(embedding: number[], options?: SearchOptions): Promise<SearchResult[]>;

  /** Insert vectors into the store */
  insert(records: VectorRecord[]): Promise<void>;

  /** Delete vectors by ID */
  delete(ids: string[]): Promise<void>;

  /** Total number of stored vectors */
  count(): Promise<number>;
}
