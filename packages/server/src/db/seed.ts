// ═══════════════════════════════════════════════════════════════════
// Database Seed — bootstrap development data
// ═══════════════════════════════════════════════════════════════════
//
// V0 has no auth yet, but organizations.owner_id is NOT NULL and FKs to
// users. This seeds a single dev user so org/repo creation works locally.
//
// Run from repo root:  pnpm db:seed
// ═══════════════════════════════════════════════════════════════════

import { eq } from "drizzle-orm";
import { loadConfig } from "@apigent/core/config";
import { closeDB, getDB } from "./connection";
import { users } from "./schema";

const DEV_USER_EMAIL = "admin@apigent.local";

export async function seed(): Promise<void> {
  loadConfig();
  const db = getDB();

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, DEV_USER_EMAIL))
    .limit(1);

  if (existing.length > 0) {
    console.log("[seed] Dev user already exists — nothing to do");
  } else {
    await db.insert(users).values({
      email: DEV_USER_EMAIL,
      // Placeholder until auth lands — no real authentication is in use yet.
      passwordHash: "placeholder-not-configured",
      name: "Apigent Admin",
    });
    console.log(`[seed] Created dev user ${DEV_USER_EMAIL}`);
  }

  await closeDB();
}

// Run directly:  pnpm --filter @apigent/server seed
if (process.argv[1]?.endsWith("seed.ts")) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[seed] Failed:", err);
      process.exit(1);
    });
}
