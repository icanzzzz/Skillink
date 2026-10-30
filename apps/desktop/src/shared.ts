import type {
  ApplyReport,
  DoctorReport,
  GcReport,
  HistoryEntry,
  ImportResult,
  StatusReport,
} from '@skillink/core';
import type {
  RouteFile,
  SkillLock,
  SkillsFile,
  TargetRoute,
} from '@skillink/shared';
import type {
  AddTargetRequest,
  ApplyRequest,
  GcRequest,
  ImportFolderRequest,
  LibraryRemoveRequest,
  LibraryTagRequest,
  RollbackRequest,
  RouteAddRequest,
  RouteRemoveRequest,
} from './ipc-schemas.js';

export interface DesktopSnapshot {
  home: string;
  library: SkillsFile;
  route: RouteFile;
  status: StatusReport;
  doctor: DoctorReport;
}

export interface DesktopApi {
  getSnapshot(): Promise<DesktopSnapshot>;
  apply(options?: ApplyRequest): Promise<ApplyReport>;
  chooseFolder(): Promise<string | null>;
  importFolder(input: ImportFolderRequest): Promise<ImportResult>;
  addTarget(input: AddTargetRequest): Promise<TargetRoute>;
  routeAdd(input: RouteAddRequest): Promise<SkillLock>;
  routeRemove(input: RouteRemoveRequest): Promise<boolean>;
  libraryTag(input: LibraryTagRequest): Promise<void>;
  libraryRemove(input: LibraryRemoveRequest): Promise<void>;
  gc(input?: GcRequest): Promise<GcReport>;
  history(): Promise<HistoryEntry[]>;
  rollback(input: RollbackRequest): Promise<void>;
}
