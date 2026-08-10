import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();

app.get("/", (c) => c.json({ name: "Apigent Open Gateway", version: "0.1.0" }));

// Only start the server when this file is run directly
if (process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js")) {
  serve({ fetch: app.fetch, port: 3002 }, (info: { port: number }) => {
    console.log(`Apigent Gateway running at http://localhost:${info.port}`);
  });
}

export default app;
