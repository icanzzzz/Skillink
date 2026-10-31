import { z } from 'zod';
import { LOCALE_PATTERN, TargetModeSchema } from '@skillink/shared';

const NonEmptyString = z.string().min(1);
const LocaleString = z.string().regex(LOCALE_PATTERN, 'Invalid locale tag.');
const OptionalNonEmptyString = NonEmptyString.optional();
const DependencyMap = z.record(z.string(), NonEmptyString);

export const ImportSkillRequestSchema = z
  .object({
    sourceDir: NonEmptyString,
    name: OptionalNonEmptyString,
    version: OptionalNonEmptyString,
  })
  .strict();

export const ScanSkillsRequestSchema = z
  .object({
    sourceDir: NonEmptyString,
  })
  .strict();

export const AddTargetRequestSchema = z
  .object({
    path: NonEmptyString,
    id: OptionalNonEmptyString,
    label: OptionalNonEmptyString,
    mode: TargetModeSchema.optional(),
  })
  .strict();

export const RouteAddRequestSchema = z
  .object({
    targetId: NonEmptyString,
    name: NonEmptyString,
    requested: NonEmptyString,
  })
  .strict();

export const RouteRemoveRequestSchema = z
  .object({
    targetId: NonEmptyString,
    name: NonEmptyString,
  })
  .strict();

export const RouteEnableRequestSchema = z
  .object({
    targetId: NonEmptyString,
    name: NonEmptyString,
    enabled: z.boolean(),
  })
  .strict();

export const TargetRemoveRequestSchema = z
  .object({
    id: NonEmptyString,
  })
  .strict();

export const TargetEnableRequestSchema = z
  .object({
    id: NonEmptyString,
    enabled: z.boolean(),
  })
  .strict();

export const SkillTagRequestSchema = z
  .object({
    name: NonEmptyString,
    version: NonEmptyString,
    tag: NonEmptyString,
  })
  .strict();

export const SkillRemoveRequestSchema = z
  .object({
    name: NonEmptyString,
    version: NonEmptyString,
  })
  .strict();

export const PackageTagRequestSchema = z
  .object({
    name: NonEmptyString,
    version: NonEmptyString,
    tag: NonEmptyString,
  })
  .strict();

export const PackageRemoveRequestSchema = z
  .object({
    name: NonEmptyString,
    version: NonEmptyString,
  })
  .strict();

export const CreatePackageRequestSchema = z
  .object({
    name: NonEmptyString,
    version: NonEmptyString,
    description: OptionalNonEmptyString,
    skills: DependencyMap.optional().default({}),
    packages: DependencyMap.optional().default({}),
  })
  .strict()
  .refine(
    (value) =>
      Object.keys(value.skills).length + Object.keys(value.packages).length > 0,
    { message: 'Package must contain at least one dependency.' },
  );

export const CopyPackageRequestSchema = z
  .object({
    sourceName: NonEmptyString,
    sourceVersion: NonEmptyString,
    targetName: NonEmptyString,
    targetVersion: NonEmptyString,
    description: OptionalNonEmptyString,
    skillOverrides: DependencyMap.optional(),
    packageOverrides: DependencyMap.optional(),
    dropSkills: z.array(NonEmptyString).optional(),
    dropPackages: z.array(NonEmptyString).optional(),
  })
  .strict();

export const GcRequestSchema = z
  .object({
    dryRun: z.boolean().optional(),
    maxAgeDays: z.number().int().nonnegative().optional(),
    keepTagged: z.boolean().optional(),
  })
  .strict();

export const RollbackRequestSchema = z
  .object({
    id: NonEmptyString,
  })
  .strict();

export const ApplyRequestSchema = z
  .object({
    dryRun: z.boolean().optional(),
    prune: z.boolean().optional(),
    targetId: OptionalNonEmptyString,
  })
  .strict();

export const LanguageInstallRequestSchema = z
  .object({
    path: NonEmptyString,
    use: z.boolean().optional(),
    force: z.boolean().optional(),
  })
  .strict();

export const LanguageUseRequestSchema = z
  .object({
    locale: LocaleString,
  })
  .strict();

export const LanguageRemoveRequestSchema = z
  .object({
    locale: LocaleString,
  })
  .strict();

export type ImportSkillRequest = z.infer<typeof ImportSkillRequestSchema>;
export type ScanSkillsRequest = z.infer<typeof ScanSkillsRequestSchema>;
export type AddTargetRequest = z.infer<typeof AddTargetRequestSchema>;
export type RouteAddRequest = z.infer<typeof RouteAddRequestSchema>;
export type RouteRemoveRequest = z.infer<typeof RouteRemoveRequestSchema>;
export type RouteEnableRequest = z.infer<typeof RouteEnableRequestSchema>;
export type TargetRemoveRequest = z.infer<typeof TargetRemoveRequestSchema>;
export type TargetEnableRequest = z.infer<typeof TargetEnableRequestSchema>;
export type SkillTagRequest = z.infer<typeof SkillTagRequestSchema>;
export type SkillRemoveRequest = z.infer<typeof SkillRemoveRequestSchema>;
export type PackageTagRequest = z.infer<typeof PackageTagRequestSchema>;
export type PackageRemoveRequest = z.infer<typeof PackageRemoveRequestSchema>;
export type CreatePackageRequest = z.infer<typeof CreatePackageRequestSchema>;
export type CopyPackageRequest = z.infer<typeof CopyPackageRequestSchema>;
export type GcRequest = z.infer<typeof GcRequestSchema>;
export type RollbackRequest = z.infer<typeof RollbackRequestSchema>;
export type ApplyRequest = z.infer<typeof ApplyRequestSchema>;
export type LanguageInstallRequest = z.infer<
  typeof LanguageInstallRequestSchema
>;
export type LanguageUseRequest = z.infer<typeof LanguageUseRequestSchema>;
export type LanguageRemoveRequest = z.infer<typeof LanguageRemoveRequestSchema>;
