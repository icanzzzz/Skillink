import type { PackageFile, RouteFile, SkillFile } from './schemas.js';

export type ApplyOperationKind =
  | 'create-target'
  | 'create-link'
  | 'replace-link'
  | 'skip';

export interface ApplyOperation {
  kind: ApplyOperationKind;
  targetId: string;
  targetPath: string;
  name?: string;
  version?: string;
  path: string;
  sourcePath?: string;
}

export interface ApplyReport {
  dryRun: boolean;
  ok: boolean;
  operations: ApplyOperation[];
}

export type StatusState =
  | 'ok'
  | 'missing'
  | 'wrong-mode'
  | 'wrong-version'
  | 'broken-link'
  | 'conflict'
  | 'disabled';

export interface StatusEntry {
  targetId: string;
  targetPath: string;
  name: string;
  version: string;
  state: StatusState;
  path: string;
  sourcePath?: string;
  packageName?: string;
  detail?: string;
}

export interface StatusReport {
  healthy: boolean;
  entries: StatusEntry[];
}

export const DOCTOR_ISSUE_CODES = [
  'MISSING_CONTENT',
  'ORPHAN_CONTENT',
  'ROUTE_MISSING_VERSION',
  'PACKAGE_INTEGRITY_MISMATCH',
  'SKILL_NOT_FOUND',
  'SKILL_MD_MISSING',
  'SKILL_INTEGRITY_MISMATCH',
  'SKILL_VERSION_CONFLICT',
  'UNSUPPORTED_MODE',
  'PACKAGE_CYCLE',
  'PACKAGE_MISSING_VERSION',
  'UNUSED_PACKAGE_VERSION',
  'LINK_ISSUE',
  'UNSAFE_PATH',
  'INVALID_CONFIG',
] as const;

export type DoctorIssueCode = (typeof DOCTOR_ISSUE_CODES)[number];

export interface DoctorIssue {
  code: DoctorIssueCode;
  message: string;
  name?: string;
  version?: string;
  targetId?: string;
  path?: string;
  packageName?: string;
  details?: Record<string, unknown>;
}

export interface DoctorReport {
  ok: boolean;
  issues: DoctorIssue[];
}

export interface GcCandidate {
  name: string;
  version: string;
  path: string;
  size: number;
  modifiedAt: string;
}

export interface GcPlan {
  dryRun: boolean;
  candidates: GcCandidate[];
  freedBytes: number;
}

export interface GcReport extends GcPlan {
  removed: GcCandidate[];
}

export interface ImportSkillResult {
  name: string;
  version: string;
  integrity: string;
  path: string;
  fileCount: number;
  size: number;
  created: boolean;
}

export interface SkillPackageCandidate {
  sourceDir: string;
  name?: string;
  version?: string;
  description?: string;
  directoryLinks: string[];
}

export interface SkillPackageScanReport {
  rootDir: string;
  packages: SkillPackageCandidate[];
}

export interface TargetSkillSummary {
  targetId: string;
  skills: Array<{ name: string; version: string }>;
  error?: string;
}

export interface SnapshotReport {
  home: string;
  skills: SkillFile;
  packages: PackageFile;
  route: RouteFile;
  status: StatusReport;
  doctor: DoctorReport;
  targetSkills: TargetSkillSummary[];
}

export interface GitHistoryEntry {
  /** commit hash */
  id: string;
  /** ISO date */
  createdAt: string;
  /** commit subject */
  reason: string;
}

export interface CliErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
