// ═══════════════════════════════════════════════════════════════════
// Platform Keys Service — API / MCP secret keys
// ═══════════════════════════════════════════════════════════════════

import { and, desc, eq, isNull } from "drizzle-orm";
import { getDB, secretKeys } from "@apigent/server/db";

export interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export async function listApiKeys(userId: string): Promise<ApiKeySummary[]> {
  return getDB()
    .select({
      id: secretKeys.id,
      name: secretKeys.name,
      keyPrefix: secretKeys.keyPrefix,
      scopes: secretKeys.scopes,
      lastUsedAt: secretKeys.lastUsedAt,
      expiresAt: secretKeys.expiresAt,
      createdAt: secretKeys.createdAt,
    })
    .from(secretKeys)
    .where(and(eq(secretKeys.userId, userId), isNull(secretKeys.revokedAt)))
    .orderBy(desc(secretKeys.createdAt))
    .then((rows) =>
      rows.map((row) => ({ ...row, scopes: row.scopes ?? [] })),
    );
}
