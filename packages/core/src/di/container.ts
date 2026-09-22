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
// 注册 API：`registerVectorStoreFactory` / `registerStorageFactory` /
// `registerQueueFactory`。三条契约见下方注释。每个组件一张
// `name → factory` 表，键就是配置里 `provider` 字段的取值。
//
// LLM / Embedding 不在这里：它们曾经是永远抛错的死 stub，P1-1 起统一走
// `@apigent/core/ai`（工厂模式 + AI SDK 的 LanguageModel / EmbeddingModel）。
// 见 docs/modules/rag-package.md §9 A1。
//
// Usage:
//   import { getContainer } from "@apigent/core/di";
//   const vs = getContainer().getVectorStore();
//   await vs.search(embedding);
// ═══════════════════════════════════════════════════════════════════

import type { ApigentConfig } from "../config";
import type { VectorStore, StorageProvider, QueueProvider } from "../types";
import { MemoryVectorStore, LocalStorageProvider, MemoryQueueProvider } from "./providers";

/** 组件工厂：吃完整配置，吐出该组件的 provider 实例。 */
export type ProviderFactory<T> = (config: ApigentConfig) => T;

export class Container {
  private config: ApigentConfig;

  private _vectorStore?: VectorStore;
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

  // ─────────────────────────────────────────────────────────────────
  // Provider 注册
  // ─────────────────────────────────────────────────────────────────
  //
  // 供「拥有实现」的包在启动时调用（例：packages/server/queue 注册
  // `postgres → PgQueueProvider`）。三条契约：
  //
  //   1. fail-fast —— 未注册的 provider 在**首次访问**时抛错，不静默回退到
  //      memory / stub（见 resolve()）。
  //   2. 键就是配置里 `provider` 字段的取值，因此**可以是 npm 包名**。
  //      P0-6 定案：`provider` 字段接受「内置枚举值 | npm 包名」。
  //   3. 同名重复注册**以后注册者为准**。内置实现在构造函数里先注册，所以
  //      外部包可以借这条覆盖内置同名实现。

  registerVectorStoreFactory(name: string, factory: ProviderFactory<VectorStore>): void {
    this.vectorStoreFactories[name] = factory;
  }

  registerStorageFactory(name: string, factory: ProviderFactory<StorageProvider>): void {
    this.storageFactories[name] = factory;
  }

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
