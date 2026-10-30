import { z } from 'zod';

export const SkillVersionSchema = z.object({
  integrity: z.string().min(1),
  fileCount: z.number().int().nonnegative(),
  size: z.number().int().nonnegative(),
  built: z.boolean().optional().default(false),
  metadata: z.record(z.string(), z.string()).optional(),
});

export const SkillEntrySchema = z.object({
  description: z.string().optional(),
  tags: z.record(z.string(), z.string()).optional(),
  versions: z.record(z.string(), SkillVersionSchema),
});

export const SkillFileSchema = z.object({
  schemaVersion: z.literal(2),
  skills: z.record(z.string(), SkillEntrySchema),
});

export const PackageVersionSchema = z
  .object({
    packages: z.record(z.string(), z.string()).optional().default({}),
    skills: z.record(z.string(), z.string()).optional().default({}),
  })
  .refine(
    (value) =>
      Object.keys(value.packages).length + Object.keys(value.skills).length > 0,
    { message: 'Package version must contain at least one package or skill.' },
  );

export const PackageEntrySchema = z
  .object({
    description: z.string().optional(),
    tags: z.record(z.string(), z.string()).optional(),
    versions: z.record(z.string(), PackageVersionSchema),
  })
  .refine((value) => Object.keys(value.versions).length > 0, {
    message: 'Package must contain at least one version.',
  });

export const PackageFileSchema = z.object({
  schemaVersion: z.literal(2),
  packages: z.record(z.string(), PackageEntrySchema),
});

export const TargetModeSchema = z.enum(['link', 'copy']);

export const PackageLockSchema = z.object({
  requested: z.string().optional(),
  resolved: z.string().min(1),
  integrity: z.string().min(1),
  enabled: z.boolean().optional().default(true),
});

export const TargetRouteSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  path: z.string().min(1),
  mode: TargetModeSchema,
  enabled: z.boolean().optional().default(true),
  packages: z.record(z.string(), PackageLockSchema),
});

export const RouteFileSchema = z.object({
  schemaVersion: z.literal(2),
  targets: z.array(TargetRouteSchema),
});

export type SkillVersion = z.infer<typeof SkillVersionSchema>;
export type SkillEntry = z.infer<typeof SkillEntrySchema>;
export type SkillFile = z.infer<typeof SkillFileSchema>;
export type PackageVersion = z.infer<typeof PackageVersionSchema>;
export type PackageEntry = z.infer<typeof PackageEntrySchema>;
export type PackageFile = z.infer<typeof PackageFileSchema>;
export type TargetMode = z.infer<typeof TargetModeSchema>;
export type PackageLock = z.infer<typeof PackageLockSchema>;
export type TargetRoute = z.infer<typeof TargetRouteSchema>;
export type RouteFile = z.infer<typeof RouteFileSchema>;

export function createEmptySkillFile(): SkillFile {
  return { schemaVersion: 2, skills: {} };
}

export function createEmptyPackageFile(): PackageFile {
  return { schemaVersion: 2, packages: {} };
}

export function createEmptyRouteFile(): RouteFile {
  return { schemaVersion: 2, targets: [] };
}
