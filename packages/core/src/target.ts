import path from 'node:path';
import {
  SkillinkError,
  type SkillinkPaths,
  type TargetMode,
  type TargetRoute,
} from '@skillink/shared';
import { assertSafePackageName } from './package-name.js';
import { assertSafeTargetPath, isSamePath } from './path-policy.js';
import { readRouteFile, writeRouteFile } from './route.js';

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
  const targetPath = assertSafeTargetPath(input.path, input.paths);
  const id = assertSafePackageName(
    input.id?.trim() || slugify(input.label ?? path.basename(targetPath)),
  );

  if (route.targets.some((target) => target.id === id)) {
    throw new SkillinkError('TARGET_EXISTS', `Target "${id}" already exists.`, {
      id,
    });
  }

  if (route.targets.some((target) => isSamePath(target.path, targetPath))) {
    throw new SkillinkError(
      'TARGET_EXISTS',
      `A target already uses path "${targetPath}".`,
      { path: targetPath },
    );
  }

  const target: TargetRoute = {
    id,
    label: input.label,
    path: targetPath,
    mode: input.mode ?? 'link',
    enabled: true,
    skills: {},
  };

  route.targets.push(target);
  await writeRouteFile(input.paths, route);

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

  const [removed] = route.targets.splice(index, 1);
  await writeRouteFile(input.paths, route);

  return removed!;
}
