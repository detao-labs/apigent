// ═══════════════════════════════════════════════════════════════════
// Storage Provider Interface
// ═══════════════════════════════════════════════════════════════════

export interface StorageProvider {
  /** Save a file */
  save(path: string, content: Buffer): Promise<void>;

  /** Read a file */
  read(path: string): Promise<Buffer>;

  /** Delete a file */
  delete(path: string): Promise<void>;

  /** Check if a file exists */
  exists(path: string): Promise<boolean>;

  /** List files under a prefix */
  list(prefix: string): Promise<string[]>;
}
