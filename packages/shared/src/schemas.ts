import { z } from 'zod';

export const PackageKindSchema = z.enum(['folder', 'skill', 'unknown']);

export const LibraryVersionSchema = z.object({
  integrity: z.string().min(1),
  source: z.string().min(1),
  fileCount: z.number().int().nonnegative(),
  size: z.number().int().nonnegative(),
  built: z.boolean().optional().default(false),
  metadata: z.record(z.string(), z.string()).optional(),
});

export const LibraryPackageSchema = z.object({
  description: z.string().optional(),
  kind: PackageKindSchema.optional().default('unknown'),
  tags: z.record(z.string(), z.string()).optional(),
  versions: z.record(z.string(), LibraryVersionSchema),
});

export const SkillsFileSchema = z.object({
  schemaVersion: z.literal(1),
  packages: z.record(z.string(), LibraryPackageSchema),
});

export const TargetModeSchema = z.enum(['link', 'copy']);

export const BuildInfoSchema = z.object({
  built: z.boolean(),
  hash: z.string().optional(),
});

export const SkillLockSchema = z.object({
  requested: z.string().optional(),
  resolved: z.string().min(1),
  integrity: z.string().min(1),
  source: z.string().min(1),
  enabled: z.boolean().optional().default(true),
  build: BuildInfoSchema.optional(),
});

export const TargetRouteSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  path: z.string().min(1),
  mode: TargetModeSchema,
  enabled: z.boolean().optional().default(true),
  skills: z.record(z.string(), SkillLockSchema),
});

export const RouteFileSchema = z.object({
  schemaVersion: z.literal(1),
  targets: z.array(TargetRouteSchema),
});

export type PackageKind = z.infer<typeof PackageKindSchema>;
export type LibraryVersion = z.infer<typeof LibraryVersionSchema>;
export type LibraryPackage = z.infer<typeof LibraryPackageSchema>;
export type SkillsFile = z.infer<typeof SkillsFileSchema>;
export type TargetMode = z.infer<typeof TargetModeSchema>;
export type BuildInfo = z.infer<typeof BuildInfoSchema>;
export type SkillLock = z.infer<typeof SkillLockSchema>;
export type TargetRoute = z.infer<typeof TargetRouteSchema>;
export type RouteFile = z.infer<typeof RouteFileSchema>;

export function createEmptySkillsFile(): SkillsFile {
  return { schemaVersion: 1, packages: {} };
}

export function createEmptyRouteFile(): RouteFile {
  return { schemaVersion: 1, targets: [] };
}
