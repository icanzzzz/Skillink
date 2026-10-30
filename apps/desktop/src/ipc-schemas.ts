import { z } from 'zod';
import { TargetModeSchema } from '@skillink/shared';

const NonEmptyString = z.string().min(1);
const OptionalNonEmptyString = NonEmptyString.optional();

export const ImportFolderRequestSchema = z
  .object({
    sourceDir: NonEmptyString,
    name: OptionalNonEmptyString,
    version: OptionalNonEmptyString,
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

export const LibraryTagRequestSchema = z
  .object({
    name: NonEmptyString,
    version: NonEmptyString,
    tag: NonEmptyString,
  })
  .strict();

export const LibraryRemoveRequestSchema = z
  .object({
    name: NonEmptyString,
    version: NonEmptyString,
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

export type ImportFolderRequest = z.infer<typeof ImportFolderRequestSchema>;
export type AddTargetRequest = z.infer<typeof AddTargetRequestSchema>;
export type RouteAddRequest = z.infer<typeof RouteAddRequestSchema>;
export type RouteRemoveRequest = z.infer<typeof RouteRemoveRequestSchema>;
export type LibraryTagRequest = z.infer<typeof LibraryTagRequestSchema>;
export type LibraryRemoveRequest = z.infer<typeof LibraryRemoveRequestSchema>;
export type GcRequest = z.infer<typeof GcRequestSchema>;
export type RollbackRequest = z.infer<typeof RollbackRequestSchema>;
export type ApplyRequest = z.infer<typeof ApplyRequestSchema>;
