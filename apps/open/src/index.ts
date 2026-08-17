import { Hono } from "hono";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";
import { getAppConfig, loadConfig } from "@apigent/core/config";

// Load config — the loader searches upward for apigent.config.yaml + .env
// from the current working directory, so it works from any app location.
try {
  loadConfig();
  console.log("Config loaded successfully");
} catch (err) {
  console.error("Failed to load config:", (err as Error).message);
  process.exit(1);
}

const open = getAppConfig("open");

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
  serve({ fetch: app.fetch, port: open.port }, (info: { port: number }) => {
    console.log(`Apigent Gateway running at ${open.url} (logLevel: ${logLevel})`);
  });
}

export default app;
