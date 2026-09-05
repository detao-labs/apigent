export {
  listRepoVersions,
  activateVersion,
  compareVersions,
  getCurrentVersionId,
  VersionNotFoundError,
  type RepoVersionListRow,
} from "./service";

export type { DiffResult, DiffChange, DiffCategory, DiffChangeType } from "../diff/engine";
