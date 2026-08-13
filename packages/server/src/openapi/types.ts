// ═══════════════════════════════════════════════════════════════════
// OpenAPI Parser Service — Type Definitions
// ═══════════════════════════════════════════════════════════════════

/** All supported HTTP methods (shared with the validator) */
export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "HEAD",
  "OPTIONS",
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * Input source type for the parser.
 * `"file"` / `"text"` only describe provenance — both carry raw content
 * as a string. URL fetching is the caller's responsibility.
 */
export type ParseSourceKind = "file" | "text";

/** Parser input */
export interface ParseInput {
  source: ParseSourceKind;
  content: string;
  repoId: string;
}

/** Severity of a parsing issue */
export type IssueSeverity = "warning" | "error";

/** A single parsing issue */
export interface ParseIssue {
  /** Associated API endpoint (if applicable) */
  apiId?: string;
  severity: IssueSeverity;
  message: string;
}

/** An API parameter definition */
export interface ParameterDef {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required: boolean;
  description?: string;
  schema?: Record<string, unknown>;
  example?: unknown;
}

/** Reference to a schema (raw $ref or inline) */
export interface SchemaRef {
  /** Resolved schema object, or undefined if unresolved */
  schema?: Record<string, unknown>;
  /** Original $ref path, e.g. "#/components/schemas/Pet" */
  ref?: string;
  /** True if the $ref could not be resolved or was circular */
  unresolved?: boolean;
}

/**
 * Response definition — one entry per (status code, media type) pair.
 * A status code without content, or with content but no schema, yields a
 * single entry with only statusCode/description.
 */
export interface ResponseDef {
  statusCode: string;
  description: string;
  /** Media type, e.g. "application/json" or "multipart/form-data" */
  contentType?: string;
  /** Schema for this media type (SchemaRef wrapper is preserved) */
  schema?: SchemaRef;
}

/** Security requirement (map from scheme name to scopes) */
export type SecurityRequirement = Record<string, string[]>;

/** A single parsed API endpoint */
export interface APIEntry {
  /** Auto-generated: {method}:{path}, e.g. "GET:/users/{id}" */
  id: string;
  /** OpenAPI operationId (for cross-version identity) */
  operationId?: string;
  method: HttpMethod;
  path: string;
  summary?: string;
  description?: string;
  parameters: ParameterDef[];
  requestBody?: SchemaRef;
  /** Media type of the request body, e.g. "multipart/form-data" (first declared media type with a schema) */
  requestContentType?: string;
  responses: ResponseDef[];
  tags: string[];
  security: SecurityRequirement[];
  deprecated: boolean;
}

/** A parsed schema / data model from components/schemas */
export interface SchemaEntry {
  name: string;
  type?: string;
  description?: string;
  properties: Record<string, unknown>;
  required: string[];
}

/** Metadata about the parsed spec */
export interface ParseMeta {
  openapiVersion: string;
  parsedAt: number;
  specTitle?: string;
  specVersion?: string;
}

/** Full parser output */
export interface ParsedAPIModel {
  repoId: string;
  apis: APIEntry[];
  schemas: SchemaEntry[];
  parseIssues: ParseIssue[];
  meta: ParseMeta;
}
