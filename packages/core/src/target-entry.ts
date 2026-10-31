import { realpath } from 'node:fs/promises';
import {
  SkillinkError,
  type SkillVersion,
  type TargetMode,
} from '@skillink/shared';
import { DEFAULT_IMPORT_LIMITS, scanFolder } from './folder-scan.js';
import { inspectPath, type PathInspection } from './links.js';
import { isNodeError } from './node-error.js';
import { isSamePath } from './path-policy.js';

export type TargetEntryComparison =
  | { kind: 'missing' }
  | { kind: 'ok'; actual: PathInspection }
  | { kind: 'wrong-mode'; actual: PathInspection }
  | { kind: 'wrong-version'; actual: PathInspection }
  | { kind: 'broken-link'; actual: PathInspection }
  | { kind: 'error'; actual: PathInspection; error: unknown };

export interface CompareTargetEntryInput {
  destination: string;
  sourcePath: string;
  mode: TargetMode;
  expected: SkillVersion;
}

async function isSameRealPath(left: string, right: string): Promise<boolean> {
  try {
    const [realLeft, realRight] = await Promise.all([
      realpath(left),
      realpath(right),
    ]);
    return isSamePath(realLeft, realRight);
  } catch {
    return false;
  }
}

function classifyScanError(
  error: unknown,
): 'broken-link' | 'wrong-version' | 'error' {
  if (
    error instanceof SkillinkError &&
    (error.code === 'UNSAFE_PATH' || error.code === 'IMPORT_LIMIT_EXCEEDED')
  ) {
    return 'wrong-version';
  }

  if (isNodeError(error)) {
    if (error.code === 'ENOENT' || error.code === 'ELOOP') {
      return 'broken-link';
    }
    if (error.code === 'ENOTDIR' || error.code === 'EISDIR') {
      return 'wrong-version';
    }
  }

  return 'error';
}

export async function compareTargetEntry(
  input: CompareTargetEntryInput,
): Promise<TargetEntryComparison> {
  const actual = await inspectPath(input.destination);
  if (actual.kind === 'missing') {
    return { kind: 'missing' };
  }

  if (input.mode === 'link') {
    if (actual.kind !== 'link') {
      return { kind: 'wrong-mode', actual };
    }

    if (await isSameRealPath(input.destination, input.sourcePath)) {
      return { kind: 'ok', actual };
    }
  } else if (actual.kind !== 'directory') {
    return { kind: 'wrong-mode', actual };
  }

  let scan;
  try {
    scan = await scanFolder(input.destination, DEFAULT_IMPORT_LIMITS);
  } catch (error) {
    const kind = classifyScanError(error);
    return kind === 'error'
      ? { kind: 'error', actual, error }
      : { kind, actual };
  }

  const matches =
    scan.kind === 'skill' &&
    scan.integrity === input.expected.integrity &&
    scan.fileCount === input.expected.fileCount &&
    scan.totalSize === input.expected.size;

  return matches
    ? { kind: 'ok', actual }
    : { kind: 'wrong-version', actual };
}
