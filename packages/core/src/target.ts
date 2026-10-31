import path from 'node:path';
import {
  SkillinkError,
  expandPath,
  type SkillinkPaths,
  type TargetMode,
  type TargetRoute,
} from '@skillink/shared';
import {
  assertNoCaseInsensitiveCollision,
  assertSafePackageName,
} from './package-name.js';
import {
  assertSafeRealTargetPath,
  isPathInside,
  isSamePath,
} from './path-policy.js';
import {
  readRouteFile,
  validateTargetRoute,
  writeRouteFile,
} from './route.js';
import { withHistory } from './history.js';
import { gcTargetEntries, resolveTargetSkillNames } from './target-gc.js';

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'target';
}

export interface AddTargetInput {
  paths: SkillinkPaths;
  id?: string;
  label?: string;
  path: string;
  mode?: TargetMode;
}

export async function addTarget(input: AddTargetInput): Promise<TargetRoute> {
  const route = await readRouteFile(input.paths);
  const targetPath = await assertSafeRealTargetPath(
    expandPath(input.path),
    input.paths,
  );
  const id = assertSafePackageName(
    input.id?.trim() || slugify(input.label ?? path.basename(targetPath)),
  );
  const mode = input.mode ?? 'link';

  if (mode !== 'link') {
    throw new SkillinkError(
      'COPY_MODE_UNSUPPORTED',
      'Copy mode is not implemented yet; use mode "link" instead.',
      { mode },
    );
  }

  assertNoCaseInsensitiveCollision(
    route.targets.map((target) => target.id),
    id,
    'target',
  );

  if (route.targets.some((target) => target.id === id)) {
    throw new SkillinkError('TARGET_EXISTS', `Target "${id}" already exists.`, {
      id,
    });
  }

  if (
    route.targets.some(
      (target) =>
        isSamePath(target.path, targetPath) ||
        isPathInside(targetPath, target.path) ||
        isPathInside(target.path, targetPath),
    )
  ) {
    throw new SkillinkError(
      'TARGET_EXISTS',
      `A target already uses or overlaps path "${targetPath}".`,
      { path: targetPath },
    );
  }

  const target: TargetRoute = {
    id,
    label: input.label,
    path: targetPath,
    mode,
    enabled: true,
    packages: {},
  };

  await withHistory(input.paths, 'add-target', async () => {
    route.targets.push(target);
    await writeRouteFile(input.paths, route);
  });

  return target;
}

export async function setTargetEnabled(
  paths: SkillinkPaths,
  targetId: string,
  enabled: boolean,
): Promise<TargetRoute> {
  const route = await readRouteFile(paths);
  const target = route.targets.find((entry) => entry.id === targetId);

  if (!target) {
    throw new SkillinkError(
      'TARGET_NOT_FOUND',
      `Target "${targetId}" does not exist.`,
      { targetId },
    );
  }

  const wasEnabled = target.enabled;
  const skillNames =
    !enabled && wasEnabled
      ? await resolveTargetSkillNames({ paths, target }).catch(() => [])
      : [];

  target.enabled = enabled;
  if (enabled) {
    await validateTargetRoute(paths, target);
  }
  await withHistory(paths, enabled ? 'enable-target' : 'disable-target', async () => {
    if (skillNames.length > 0) {
      await gcTargetEntries({ paths, target, skillNames });
    }
    await writeRouteFile(paths, route);
  });

  return target;
}

export interface RemoveTargetInput {
  paths: SkillinkPaths;
  id: string;
}

export async function removeTarget(input: RemoveTargetInput): Promise<TargetRoute> {
  const route = await readRouteFile(input.paths);
  const index = route.targets.findIndex((target) => target.id === input.id);

  if (index === -1) {
    throw new SkillinkError(
      'TARGET_NOT_FOUND',
      `Target "${input.id}" does not exist.`,
      { id: input.id },
    );
  }

  const removed = route.targets[index]!;
  const skillNames = await resolveTargetSkillNames({
    paths: input.paths,
    target: removed,
  });

  route.targets.splice(index, 1);
  await withHistory(input.paths, 'remove-target', async () => {
    await gcTargetEntries({
      paths: input.paths,
      target: removed,
      skillNames,
    });
    await writeRouteFile(input.paths, route);
  });

  return removed;
}
