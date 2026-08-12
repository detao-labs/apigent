// ═══════════════════════════════════════════════════════════════════
// Exports the platform OpenAPI document to apps/platform/openapi/platform.json.
// Run with: pnpm --filter @apigent/platform openapi:export
// ═══════════════════════════════════════════════════════════════════

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenApiDocument } from "../src/lib/openapi";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.resolve(scriptDir, "../openapi/platform.json");

async function main() {
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(
    outFile,
    `${JSON.stringify(createOpenApiDocument(), null, 2)}\n`,
    "utf8",
  );

  console.log(`OpenAPI spec written to ${outFile}`);
}

void main();
