import type { DoctorReport, StatusReport } from '@skillink/core';
import type { RouteFile, SkillsFile } from '@skillink/shared';

export interface DesktopSnapshot {
  home: string;
  library: SkillsFile;
  route: RouteFile;
  status: StatusReport;
  doctor: DoctorReport;
}

export interface ApplyOptions {
  dryRun?: boolean;
  prune?: boolean;
  targetId?: string;
}

export interface DesktopApi {
  getSnapshot(): Promise<DesktopSnapshot>;
  apply(options?: ApplyOptions): Promise<unknown>;
}
