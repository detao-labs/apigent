// ═══════════════════════════════════════════════════════════════════
// DI Container — Dependency Injection Container
// ═══════════════════════════════════════════════════════════════════
//
// Maps config choices to provider instances. All access goes through
// getContainer(), which lazy-initializes instances on first use.
//
// Fail-fast contract: a configured provider with no registered factory
// throws when first accessed — never a silent stub/memory fallback.
// Providers are registered per-component in factory registries, so
// adding a real implementation is a one-line registration, not a switch
// edit.
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
import { MemoryVectorStore, LocalStorageProvider, MemoryQueueProvider } from "./providers";

type ProviderFactory<T> = (config: ApigentConfig) => T;

export class Container {
  private config: ApigentConfig;

  private _vectorStore?: VectorStore;
  private _llm?: LLMProvider;
  private _embedding?: EmbeddingProvider;
  private _storage?: StorageProvider;
  private _queue?: QueueProvider;

  private readonly vectorStoreFactories: Record<string, ProviderFactory<VectorStore>>;
  private readonly storageFactories: Record<string, ProviderFactory<StorageProvider>>;
  private readonly queueFactories: Record<string, ProviderFactory<QueueProvider>>;

  constructor(config: ApigentConfig) {
    this.config = config;

    this.vectorStoreFactories = {
      memory: () => new MemoryVectorStore(),
    };
    this.storageFactories = {
      local: (c) => {
        if (c.storage.provider !== "local") {
          throw new Error(`Storage provider '${c.storage.provider}' is not 'local'.`);
        }
        return new LocalStorageProvider(c.storage.basePath);
      },
    };
    this.queueFactories = {
      memory: () => new MemoryQueueProvider(),
    };
  }

  private resolve<T>(
    component: string,
    registries: Record<string, ProviderFactory<T>>,
    provider: string,
    hint?: string,
  ): ProviderFactory<T> {
    const factory = registries[provider];
    if (!factory) {
      const hintSuffix = hint ? ` ${hint}` : "";
      throw new Error(`${component} provider '${provider}' is not implemented yet.${hintSuffix}`);
    }
    return factory;
  }

  /**
   * Register a provider factory for a component.
   * Used by packages that own the implementation (e.g. packages/server
   * registers the "postgres" queue factory) — fail-fast contract still
   * applies: an unregistered provider throws on first access.
   */
  registerQueueFactory(name: string, factory: ProviderFactory<QueueProvider>): void {
    this.queueFactories[name] = factory;
  }

  getVectorStore(): VectorStore {
    if (!this._vectorStore) {
      const factory = this.resolve(
        "Vector store",
        this.vectorStoreFactories,
        this.config.rag.vectorStore.provider,
        "Use 'provider: memory' for local development.",
      );
      this._vectorStore = factory(this.config);
    }
    return this._vectorStore;
  }

  getLLM(): LLMProvider {
    if (!this._llm) {
      // No LLM providers are implemented yet — fail fast at wiring time
      // instead of substituting a stub that throws at call time.
      throw new Error(`LLM provider '${this.config.llm.provider}' is not implemented yet.`);
    }
    return this._llm;
  }

  getEmbedding(): EmbeddingProvider {
    if (!this._embedding) {
      throw new Error(
        `Embedding provider '${this.config.rag.embedding.provider}' is not implemented yet.`,
      );
    }
    return this._embedding;
  }

  getStorage(): StorageProvider {
    if (!this._storage) {
      const factory = this.resolve(
        "Storage",
        this.storageFactories,
        this.config.storage.provider,
        "Use 'provider: local' for local development.",
      );
      this._storage = factory(this.config);
    }
    return this._storage;
  }

  getQueue(): QueueProvider {
    if (!this._queue) {
      const factory = this.resolve(
        "Queue",
        this.queueFactories,
        this.config.queue.provider,
        "Use 'provider: memory' for local development.",
      );
      this._queue = factory(this.config);
    }
    return this._queue;
  }
}
