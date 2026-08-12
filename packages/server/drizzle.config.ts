import { defineConfig } from "drizzle-kit";
import { loadConfig } from "@apigent/core/config";

// Resolve the connection string through the project config system
// (apigent.config.yaml + .env, searched upward from cwd).
const config = loadConfig();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: config.database.url,
  },
});
