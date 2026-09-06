// ═══════════════════════════════════════════════════════════════════
// OpenAPI Parser Service — Barrel Export
// ═══════════════════════════════════════════════════════════════════

export { parseOpenAPI } from "./parser";
export { resolveRefs } from "./ref-resolver";
export { validateAPI, validateSchema } from "./validator";
export { buildEndpointKey, METHOD_PATH_SEPARATOR } from "./key";
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
