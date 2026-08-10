// ═══════════════════════════════════════════════════════════════════
// Stub Embedding Provider — Dev Only (Throws on Use)
// ═══════════════════════════════════════════════════════════════════

import type { EmbeddingProvider } from "../../types";

export class StubEmbeddingProvider implements EmbeddingProvider {
  private message =
    "Embedding provider not configured. Set APIGENT_EMBEDDING_PROVIDER and provide an API key.";

  async embed(_texts: string[]): Promise<number[][]> {
    throw new Error(this.message);
  }

  async embedQuery(_query: string): Promise<number[]> {
    throw new Error(this.message);
  }
}
