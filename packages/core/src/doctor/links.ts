import type { DoctorIssue, StatusReport } from '@skillink/shared';
import type { DoctorContext } from './issues.js';

export async function checkTargetLinks(
  _ctx: DoctorContext,
  statusReport: StatusReport,
): Promise<DoctorIssue[]> {
  const issues: DoctorIssue[] = [];

  for (const entry of statusReport.entries) {
    if (entry.state === 'ok' || entry.state === 'disabled') {
      continue;
    }
    if (entry.name.startsWith('<')) {
      continue;
    }

    issues.push({
      code: 'LINK_ISSUE',
      message: `${entry.targetId}/${entry.name}: ${entry.state}`,
      name: entry.name,
      version: entry.version || undefined,
      targetId: entry.targetId,
      path: entry.path,
      packageName: entry.packageName,
    });
  }

  return issues;
}
