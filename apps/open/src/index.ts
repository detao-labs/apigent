import { Hono } from "hono";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";
import { loadConfig } from "@apigent/core/config";

// Load config — the loader searches upward for apigent.config.yaml + .env
// from the current working directory, so it works from any app location.
try {
  loadConfig();
  console.log("Config loaded successfully");
} catch (err) {
  console.error("Failed to load config:", (err as Error).message);
  process.exit(1);
}

/** Default listening port; override with `--port <n>` (see CLAUDE.md → Port Conventions). */
const DEFAULT_PORT = 3002;

function resolvePort(): number {
  const i = process.argv.indexOf("--port");
  const raw = i !== -1 ? process.argv[i + 1] : undefined;
  const port = Number(raw ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid --port value: "${raw ?? ""}"`);
  }
  return port;
}

const port = resolvePort();

const app = new Hono();

// Request logging — honors apps.open.logLevel
const logLevel = loadConfig().apps.open.logLevel;
if (logLevel === "debug" || logLevel === "info") {
  app.use(logger());
}

app.get("/", (c) => c.json({ name: "Apigent Open Gateway", version: "0.1.0" }));
app.get("/health", (c) => c.json({ status: "ok", timestamp: Date.now() }));

// Only start the server when this file is run directly
if (process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js")) {
  serve({ fetch: app.fetch, port }, (_info: { port: number }) => {
    console.log(`Apigent Gateway running at http://localhost:${port} (logLevel: ${logLevel})`);
  });
}

export default app;
