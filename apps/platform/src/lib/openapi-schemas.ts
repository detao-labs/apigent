// ═══════════════════════════════════════════════════════════════════
// Platform API Zod schemas — single source of truth for request/response
// validation AND OpenAPI generation (zod-openapi v5 uses zod's native
// `.meta()` for OpenAPI metadata; `id` registers reusable components).
// ═══════════════════════════════════════════════════════════════════

import * as z from "zod/v4";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ─────────────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────────────

export const userSchema = z
  .object({
    id: z.uuid().meta({ description: "User UUID" }),
    email: z.email().meta({
      description: "Email address",
      example: "ada@example.com",
    }),
    name: z.string().min(1).max(255).meta({ description: "Display name" }),
  })
  .meta({ id: "User", description: "Authenticated user" });

export type User = z.infer<typeof userSchema>;

// ─────────────────────────────────────────────────────────────────────
// Auth request bodies
// ─────────────────────────────────────────────────────────────────────

export const registerBodySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .meta({ description: "Display name" }),
    email: z.email().max(255).meta({
      description: "Email address",
      example: "ada@example.com",
    }),
    password: z
      .string()
      .min(8)
      .max(128)
      .meta({ description: "Password (8–128 chars)", writeOnly: true }),
  })
  .meta({ id: "RegisterBody", description: "User registration payload" });

export type RegisterInput = z.infer<typeof registerBodySchema>;

export const loginBodySchema = z
  .object({
    email: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .meta({ description: "Email address", example: "ada@example.com" }),
    password: z
      .string()
      .min(1)
      .max(128)
      .meta({ description: "Password", writeOnly: true }),
  })
  .meta({ id: "LoginBody", description: "Login payload" });

export type LoginInput = z.infer<typeof loginBodySchema>;

// ─────────────────────────────────────────────────────────────────────
// Organizations
// ─────────────────────────────────────────────────────────────────────

const orgIdField = z.uuid().meta({ description: "Organization UUID" });
const orgNameField = z
  .string()
  .min(1)
  .max(255)
  .meta({ description: "Organization name" });
const orgSlugField = z
  .string()
  .regex(SLUG_RE)
  .max(255)
  .meta({
    description: "URL-friendly slug — lowercase letters, digits, hyphens",
    example: "acme-corp",
  });
const createdAtField = z
  .date()
  .meta({ format: "date-time", description: "Creation time (ISO 8601)" });
const updatedAtField = z
  .date()
  .meta({ format: "date-time", description: "Last update time (ISO 8601)" });

export const orgSummarySchema = z
  .object({
    id: orgIdField,
    name: orgNameField,
    slug: orgSlugField,
    createdAt: createdAtField,
  })
  .meta({ id: "OrgSummary", description: "Organization summary" });

export type OrgSummary = z.infer<typeof orgSummarySchema>;

export const orgSchema = z
  .object({
    id: orgIdField,
    name: orgNameField,
    slug: orgSlugField,
    ownerId: z.uuid().meta({ description: "Owner user UUID" }),
    createdAt: createdAtField,
    updatedAt: updatedAtField,
  })
  .meta({ id: "Org", description: "Full organization record" });

export type Org = z.infer<typeof orgSchema>;

export const orgCreateBodySchema = z
  .object({
    name: orgNameField.meta({ description: "Organization display name" }),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(SLUG_RE)
      .max(255)
      .meta({
        description:
          "URL-friendly slug — lowercase letters, digits, hyphens (e.g. acme-corp)",
        example: "acme-corp",
      }),
  })
  .meta({ id: "OrgCreateBody", description: "Organization creation payload" });

export type OrgCreateInput = z.infer<typeof orgCreateBodySchema>;

// ─────────────────────────────────────────────────────────────────────
// Common responses
// ─────────────────────────────────────────────────────────────────────

export const errorResponseSchema = z
  .object({
    error: z
      .string()
      .min(1)
      .meta({ description: "Machine-readable error code" }),
  })
  .meta({ id: "ErrorResponse", description: "Error response" });

export const okResponseSchema = z
  .object({
    ok: z.boolean().meta({ description: "Always true" }),
  })
  .meta({ id: "OkResponse", description: "Generic success response" });
