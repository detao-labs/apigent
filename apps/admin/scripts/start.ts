// ═══════════════════════════════════════════════════════════════════
// Admin — Next.js dev/start wrapper
// ═══════════════════════════════════════════════════════════════════
// Loads the app's port from apigent.config.yaml (apps.admin.url)
// and starts Next.js on that port.
//
// Usage: tsx scripts/start.ts [--dev]
// ═══════════════════════════════════════════════════════════════════

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { getAppConfig } from "@apigent/core/config";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const app = getAppConfig("admin");
const args: string[] = process.argv.includes("--dev")
  ? ["dev", "--port", String(app.port)]
  : ["start", "-p", String(app.port)];

const child = spawn(process.execPath, [nextBin, ...args], {
  stdio: "inherit",
  env: process.env,
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => child.kill(sig));
}
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
