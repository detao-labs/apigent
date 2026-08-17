// ═══════════════════════════════════════════════════════════════════
// Apigent Config — App Endpoint Helper
// ═══════════════════════════════════════════════════════════════════
//
// Resolves the runtime endpoint config for a single app from the
// fully-loaded ApigentConfig. The port is derived from the app's url,
// so apps can bind their server without duplicating the value.
// ═══════════════════════════════════════════════════════════════════

import { loadConfig } from "./file-loader";
import type { AppEndpointConfig, AppName } from "./types";

export interface ResolvedAppConfig extends AppEndpointConfig {
  /** Port parsed from the app's url */
  port: number;
}

/**
 * Get the resolved endpoint config for one app (platform / admin / open).
 * Throws if the app's url does not contain a valid port.
 */
export function getAppConfig(name: AppName): ResolvedAppConfig {
  const app = loadConfig().apps[name];

  let port: number;
  try {
    port = Number(new URL(app.url).port);
  } catch {
    port = NaN;
  }

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`apps.${name}.url must include a valid port — got: "${app.url}"`);
  }

  return { ...app, port };
}
