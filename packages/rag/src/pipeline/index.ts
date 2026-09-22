// ═══════════════════════════════════════════════════════════════════
// RAG Pipeline — Public API
// ═══════════════════════════════════════════════════════════════════

export { createRagService } from "./service";
export { createStageRegistry } from "./registry";
export { DEFAULT_PIPELINE_CONFIG } from "./types";
export type {
  RagStageKind,
  RagStageFactoryContext,
  RagStageDeps,
  RagDocumentSourceFactory,
  RagEmbedderFactory,
  RagDenseIndexFactory,
  RagStageFactoryMap,
  RagProviderRef,
  RagProviderSelection,
  RagPipelineConfig,
  RagServiceOptions,
  RagStageRegistry,
} from "./types";
