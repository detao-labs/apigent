// ═══════════════════════════════════════════════════════════════════
// Embedding Provider Interface
// ═══════════════════════════════════════════════════════════════════

export interface EmbeddingProvider {
  /** Generate embeddings for multiple texts (for indexing) */
  embed(texts: string[]): Promise<number[][]>;

  /** Generate embedding for a single query string */
  embedQuery(query: string): Promise<number[]>;
}
