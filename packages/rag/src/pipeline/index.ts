// ═══════════════════════════════════════════════════════════════════
// RAG Pipeline — Public API
// ═══════════════════════════════════════════════════════════════════

export { createRagService } from "./service";
export { createStageRegistry } from "./registry";
export {
  loadStageFactory,
  preloadStageProviders,
  STAGE_FACTORY_EXPORT_NAMES,
  loadRagServiceFactory,
  createRagServiceFromPackage,
  assertRagServiceShape,
  RAG_SERVICE_FACTORY_EXPORT_NAME,
} from "./loader";
export type { LoadStageFactoryOptions, PreloadedProvider, RagStageModuleLoader } from "./loader";
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
  RagServiceFactory,
  RagServiceFactoryContext,
  RagStageRegistry,
} from "./types";
