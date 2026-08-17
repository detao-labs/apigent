// ═══════════════════════════════════════════════════════════════════
// Stub Embedding Provider — Dev Only (Throws on Use)
// ═══════════════════════════════════════════════════════════════════

import type { EmbeddingProvider } from "../../types";

export class StubEmbeddingProvider implements EmbeddingProvider {
  private message =
    "Embedding provider not configured. Set rag.embedding.provider in apigent.config.yaml and provide the API key in .env.";

  async embed(_texts: string[]): Promise<number[][]> {
    throw new Error(this.message);
  }

  async embedQuery(_query: string): Promise<number[]> {
    throw new Error(this.message);
  }
}
