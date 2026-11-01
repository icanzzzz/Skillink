import {
  PackageFileSchema,
  RouteFileSchema,
  SkillFileSchema,
  createEmptyPackageFile,
  createEmptyRouteFile,
  createEmptySkillFile,
  type PackageFile,
  type RouteFile,
  type SkillFile,
  type SkillinkPaths,
} from '@skillink/shared';
import { readJsonFile } from './json-store.js';

export async function readRouteConfig(paths: SkillinkPaths): Promise<RouteFile> {
  return readJsonFile(paths.routeFile, RouteFileSchema, createEmptyRouteFile());
}

export async function readPackageConfig(
  paths: SkillinkPaths,
): Promise<PackageFile> {
  return readJsonFile(
    paths.packageFile,
    PackageFileSchema,
    createEmptyPackageFile(),
  );
}

export async function readSkillConfig(paths: SkillinkPaths): Promise<SkillFile> {
  return readJsonFile(paths.skillFile, SkillFileSchema, createEmptySkillFile());
}
