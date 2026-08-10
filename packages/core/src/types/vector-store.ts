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

/**
 * Field-level filter condition, e.g.
 * `{ repo_id: { $in: ["repo-1", "repo-2"] } }` — used for pre-retrieval
 * permission filtering (see docs/modules/semantic-search.agent.md §4).
 * Operators on the same field combine with AND.
 */
export interface SearchFilterCondition {
  $eq?: unknown;
  $ne?: unknown;
  $in?: readonly unknown[];
  $nin?: readonly unknown[];
  /** Case-sensitive substring match against the stringified metadata value */
  $contains?: string;
  /** Field presence check */
  $exists?: boolean;
}

/** Map from metadata field name to filter condition */
export type SearchFilter = Record<string, SearchFilterCondition>;

export interface SearchOptions {
  topK?: number;
  filter?: SearchFilter;
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
