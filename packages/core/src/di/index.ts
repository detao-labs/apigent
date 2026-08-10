// ═══════════════════════════════════════════════════════════════════
// DI Container — Public API
// ═══════════════════════════════════════════════════════════════════
//
// Single entry point: getContainer() returns the singleton instance.
// Must call loadConfig() before using the container.
// ═══════════════════════════════════════════════════════════════════

import { getConfig } from "../config/loader";
import { Container } from "./container";

let _container: Container | null = null;

/**
 * Get the singleton DI container.
 * Requires {@link loadConfig} to have been called first.
 */
export function getContainer(): Container {
  if (!_container) {
    _container = new Container(getConfig());
  }
  return _container;
}

/**
 * Replace the container instance (for testing).
 */
export function setContainer(container: Container): void {
  _container = container;
}

/**
 * Reset the container (for testing).
 */
export function resetContainer(): void {
  _container = null;
}

export { Container } from "./container";
