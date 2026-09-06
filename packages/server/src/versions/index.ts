export {
  listVersions,
  createVersion,
  setDefaultVersion,
  getDefaultVersionId,
  rollbackVersion,
  rollbackVersionSteps,
  compareVersions,
  VersionNotFoundError,
  type RepoVersionRow,
  type CreateVersionInput,
} from "./service";

export type { DiffResult, DiffChange, DiffCategory, DiffChangeType } from "../diff/engine";
