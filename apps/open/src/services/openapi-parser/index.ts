// ═══════════════════════════════════════════════════════════════════
// OpenAPI Parser Service — Barrel Export
// ═══════════════════════════════════════════════════════════════════

export { parseOpenAPI } from "./parser";
export { resolveRefs } from "./ref-resolver";
export { validateAPI, validateSchema } from "./validator";
export type {
  ParsedAPIModel,
  APIEntry,
  SchemaEntry,
  ParseIssue,
  ParseInput,
  ParseMeta,
  ParseSourceKind,
  ParameterDef,
  ResponseDef,
  SchemaRef,
  SecurityRequirement,
  HttpMethod,
} from "./types";
