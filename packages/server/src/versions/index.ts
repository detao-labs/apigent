export {
  listVersions,
  createVersion,
  setDefaultVersion,
  getDefaultVersionId,
  rollbackVersion,
  rollbackVersionSteps,
  compareVersions,
  listVersionHistory,
  deleteVersionEntity,
  VersionNotFoundError,
  type RepoVersionRow,
  type CreateVersionInput,
  type VersionHistoryEntry,
  type DeleteEntityResult,
} from "./service";

export type { DiffResult, DiffChange, DiffCategory, DiffChangeType } from "../diff/engine";
