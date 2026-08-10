// ═══════════════════════════════════════════════════════════════════
// Local Storage Provider
// ═══════════════════════════════════════════════════════════════════

import * as fs from "node:fs";
import * as path from "node:path";
import type { StorageProvider } from "../../types";

export class LocalStorageProvider implements StorageProvider {
  constructor(private basePath: string) {
    fs.mkdirSync(this.basePath, { recursive: true });
  }

  private resolve(filePath: string): string {
    const resolved = path.resolve(this.basePath, filePath);
    const relative = path.relative(this.basePath, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Path traversal not allowed: ${filePath}`);
    }
    return resolved;
  }

  async save(filePath: string, content: Buffer): Promise<void> {
    const fullPath = this.resolve(filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  async read(filePath: string): Promise<Buffer> {
    const fullPath = this.resolve(filePath);
    return fs.readFileSync(fullPath);
  }

  async delete(filePath: string): Promise<void> {
    const fullPath = this.resolve(filePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  async exists(filePath: string): Promise<boolean> {
    const fullPath = this.resolve(filePath);
    return fs.existsSync(fullPath);
  }

  async list(prefix: string): Promise<string[]> {
    const dir = this.resolve(prefix);
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => path.relative(this.basePath, path.join(e.parentPath ?? dir, e.name)));
  }
}
