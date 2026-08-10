// ═══════════════════════════════════════════════════════════════════
// DI Container — Dependency Injection Container
// ═══════════════════════════════════════════════════════════════════
//
// Maps config choices to provider instances. All access goes through
// getContainer(), which lazy-initializes instances on first use.
//
// Usage:
//   import { getContainer } from "@apigent/core/di";
//   const vs = getContainer().getVectorStore();
//   await vs.search(embedding);
// ═══════════════════════════════════════════════════════════════════

import type { ApigentConfig } from "../config";
import type {
  VectorStore,
  LLMProvider,
  EmbeddingProvider,
  StorageProvider,
  QueueProvider,
} from "../types";
import {
  MemoryVectorStore,
  StubLLMProvider,
  StubEmbeddingProvider,
  LocalStorageProvider,
  MemoryQueueProvider,
} from "./providers";

export class Container {
  private config: ApigentConfig;

  private _vectorStore?: VectorStore;
  private _llm?: LLMProvider;
  private _embedding?: EmbeddingProvider;
  private _storage?: StorageProvider;
  private _queue?: QueueProvider;

  constructor(config: ApigentConfig) {
    this.config = config;
  }

  getVectorStore(): VectorStore {
    if (!this._vectorStore) {
      const vs = this.config.vectorStore;
      switch (vs.provider) {
        case "pgvector":
          // TODO: Replace with PgVectorStore when implemented
          this._vectorStore = new MemoryVectorStore();
          break;
        case "milvus":
        case "qdrant":
        case "weaviate":
        case "pinecone":
        case "chroma":
          // TODO: Implement real providers
          this._vectorStore = new MemoryVectorStore();
          break;
        default:
          this._vectorStore = new MemoryVectorStore();
      }
    }
    return this._vectorStore;
  }

  getLLM(): LLMProvider {
    if (!this._llm) {
      const llm = this.config.llm;
      switch (llm.provider) {
        case "qwen":
        case "claude":
        case "openai":
        case "gemini":
        case "ollama":
          // TODO: Implement real LLM providers
          this._llm = new StubLLMProvider();
          break;
        default:
          this._llm = new StubLLMProvider();
      }
    }
    return this._llm;
  }

  getEmbedding(): EmbeddingProvider {
    if (!this._embedding) {
      const emb = this.config.embedding;
      switch (emb.provider) {
        case "qwen":
        case "claude":
        case "openai":
        case "cohere":
        case "local-bge":
        case "local-fastembed":
          // TODO: Implement real embedding providers
          this._embedding = new StubEmbeddingProvider();
          break;
        default:
          this._embedding = new StubEmbeddingProvider();
      }
    }
    return this._embedding;
  }

  getStorage(): StorageProvider {
    if (!this._storage) {
      const storage = this.config.storage;
      switch (storage.provider) {
        case "local":
          this._storage = new LocalStorageProvider(storage.basePath);
          break;
        case "s3":
        case "minio":
        case "gcs":
          // TODO: Implement cloud storage providers
          this._storage = new LocalStorageProvider("./data/uploads");
          break;
        default:
          this._storage = new LocalStorageProvider("./data/uploads");
      }
    }
    return this._storage;
  }

  getQueue(): QueueProvider {
    if (!this._queue) {
      const queue = this.config.queue;
      switch (queue.provider) {
        case "bullmq":
        case "rabbitmq":
        case "sqs":
          // TODO: Implement real queue providers
          this._queue = new MemoryQueueProvider();
          break;
        case "memory":
          this._queue = new MemoryQueueProvider();
          break;
        default:
          this._queue = new MemoryQueueProvider();
      }
    }
    return this._queue;
  }
}
