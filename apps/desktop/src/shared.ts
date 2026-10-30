import type {
  ApplyReport,
  GcReport,
  ImportSkillResult,
  PackageLock,
  PackageVersion,
  SnapshotReport,
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
  RouteEnableRequest,
  RouteRemoveRequest,
  SkillRemoveRequest,
  SkillTagRequest,
  TargetEnableRequest,
  TargetRemoveRequest,
} from './ipc-schemas.js';

export type DesktopSnapshot = SnapshotReport;

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
  removeTarget(input: TargetRemoveRequest): Promise<TargetRoute>;
  targetEnable(input: TargetEnableRequest): Promise<TargetRoute>;
  routeAdd(input: RouteAddRequest): Promise<PackageLock>;
  routeRemove(input: RouteRemoveRequest): Promise<boolean>;
  routeEnable(input: RouteEnableRequest): Promise<PackageLock>;
  gc(input?: GcRequest): Promise<GcReport>;
  rollback(input: RollbackRequest): Promise<void>;
}
