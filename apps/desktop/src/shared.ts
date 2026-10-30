import type {
  ApplyReport,
  DoctorReport,
  GcReport,
  HistoryEntry,
  ImportSkillResult,
  StatusReport,
} from '@skillink/core';
import type {
  PackageFile,
  PackageLock,
  PackageVersion,
  RouteFile,
  SkillFile,
  TargetRoute,
} from '@skillink/shared';
import type {
  AddTargetRequest,
  ApplyRequest,
  CopyPackageRequest,
  CreatePackageRequest,
  GcRequest,
  ImportSkillRequest,
  PackageRemoveRequest,
  PackageTagRequest,
  RollbackRequest,
  RouteAddRequest,
  RouteRemoveRequest,
  SkillRemoveRequest,
  SkillTagRequest,
} from './ipc-schemas.js';

export interface DesktopSnapshot {
  home: string;
  skills: SkillFile;
  packages: PackageFile;
  route: RouteFile;
  status: StatusReport;
  doctor: DoctorReport;
}

export interface DesktopApi {
  getSnapshot(): Promise<DesktopSnapshot>;
  apply(options?: ApplyRequest): Promise<ApplyReport>;
  chooseFolder(): Promise<string | null>;
  importSkill(input: ImportSkillRequest): Promise<ImportSkillResult>;
  createPackage(input: CreatePackageRequest): Promise<PackageVersion>;
  copyPackage(input: CopyPackageRequest): Promise<PackageVersion>;
  removePackage(input: PackageRemoveRequest): Promise<void>;
  packageTag(input: PackageTagRequest): Promise<void>;
  skillTag(input: SkillTagRequest): Promise<void>;
  skillRemove(input: SkillRemoveRequest): Promise<void>;
  addTarget(input: AddTargetRequest): Promise<TargetRoute>;
  routeAdd(input: RouteAddRequest): Promise<PackageLock>;
  routeRemove(input: RouteRemoveRequest): Promise<boolean>;
  gc(input?: GcRequest): Promise<GcReport>;
  history(): Promise<HistoryEntry[]>;
  rollback(input: RollbackRequest): Promise<void>;
}
