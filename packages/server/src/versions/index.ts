export {
  listVersions,
  createVersion,
  setDefaultVersion,
  getDefaultVersionId,
  rollbackVersion,
  rollbackVersionSteps,
  compareVersions,
  listVersionHistory,
  VersionNotFoundError,
  type RepoVersionRow,
  type CreateVersionInput,
  type VersionHistoryEntry,
} from "./service";

export type { DiffResult, DiffChange, DiffCategory, DiffChangeType } from "../diff/engine";
