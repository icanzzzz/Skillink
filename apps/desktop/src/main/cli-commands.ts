import type {
  AddTargetRequest,
  ApplyRequest,
  CopyPackageRequest,
  CreatePackageRequest,
  GcRequest,
  ImportSkillRequest,
  LanguageInstallRequest,
  PackageRemoveRequest,
  PackageTagRequest,
  RollbackRequest,
  RouteAddRequest,
  RouteEnableRequest,
  RouteRemoveRequest,
  ScanSkillsRequest,
  SkillRemoveRequest,
  SkillTagRequest,
  TargetEnableRequest,
  TargetRemoveRequest,
} from '../ipc-schemas.js';

function spec(name: string, version: string): string {
  return `${name}@${version}`;
}

function dependencyArgs(flag: string, values: Record<string, string>): string[] {
  const specs = Object.entries(values).map(([name, version]) =>
    spec(name, version),
  );
  return specs.length > 0 ? [flag, ...specs] : [];
}

function variadicArgs(flag: string, values: string[]): string[] {
  return values.length > 0 ? [flag, ...values] : [];
}

export function buildApplyArgs(request: ApplyRequest): string[] {
  return [
    'apply',
    ...(request.dryRun ? ['--dry-run'] : []),
    ...(request.prune ? ['--prune'] : []),
    ...(request.targetId ? ['--target', request.targetId] : []),
    '--json',
  ];
}

export function buildImportSkillArgs(request: ImportSkillRequest): string[] {
  return [
    'skill',
    'add',
    request.sourceDir,
    ...(request.name ? ['--name', request.name] : []),
    ...(request.version ? ['--version', request.version] : []),
    '--json',
  ];
}

export function buildScanSkillsArgs(request: ScanSkillsRequest): string[] {
  return ['skill', 'scan', request.sourceDir, '--json'];
}

export function buildCreatePackageArgs(
  request: CreatePackageRequest,
): string[] {
  return [
    'package',
    'create',
    spec(request.name, request.version),
    ...dependencyArgs('--skill', request.skills ?? {}),
    ...dependencyArgs('--package', request.packages ?? {}),
    ...(request.description ? ['--description', request.description] : []),
    '--json',
  ];
}

export function buildCopyPackageArgs(request: CopyPackageRequest): string[] {
  return [
    'package',
    'copy',
    spec(request.sourceName, request.sourceVersion),
    spec(request.targetName, request.targetVersion),
    ...dependencyArgs('--skill', request.skillOverrides ?? {}),
    ...dependencyArgs('--package', request.packageOverrides ?? {}),
    ...variadicArgs('--drop-skill', request.dropSkills ?? []),
    ...variadicArgs('--drop-package', request.dropPackages ?? []),
    ...(request.description ? ['--description', request.description] : []),
    '--json',
  ];
}

export function buildPackageRemoveArgs(
  request: PackageRemoveRequest,
): string[] {
  return ['package', 'remove', spec(request.name, request.version), '--json'];
}

export function buildPackageTagArgs(request: PackageTagRequest): string[] {
  return [
    'package',
    'tag',
    spec(request.name, request.version),
    request.tag,
    '--json',
  ];
}

export function buildSkillRemoveArgs(request: SkillRemoveRequest): string[] {
  return ['skill', 'remove', spec(request.name, request.version), '--json'];
}

export function buildSkillTagArgs(request: SkillTagRequest): string[] {
  return [
    'skill',
    'tag',
    spec(request.name, request.version),
    request.tag,
    '--json',
  ];
}

export function buildAddTargetArgs(request: AddTargetRequest): string[] {
  return [
    'target',
    'add',
    request.path,
    ...(request.id ? ['--id', request.id] : []),
    ...(request.label ? ['--label', request.label] : []),
    ...(request.mode ? ['--mode', request.mode] : []),
    '--json',
  ];
}

export function buildRemoveTargetArgs(request: TargetRemoveRequest): string[] {
  return ['target', 'remove', request.id, '--json'];
}

export function buildTargetEnableArgs(request: TargetEnableRequest): string[] {
  return [
    'target',
    request.enabled ? 'enable' : 'disable',
    request.id,
    '--json',
  ];
}

export function buildRouteAddArgs(request: RouteAddRequest): string[] {
  return [
    'route',
    'add',
    request.targetId,
    spec(request.name, request.requested),
    '--json',
  ];
}

export function buildRouteRemoveArgs(request: RouteRemoveRequest): string[] {
  return ['route', 'remove', request.targetId, request.name, '--json'];
}

export function buildRouteEnableArgs(request: RouteEnableRequest): string[] {
  return [
    'route',
    request.enabled ? 'enable' : 'disable',
    request.targetId,
    request.name,
    '--json',
  ];
}

export function buildGcArgs(request: GcRequest = {}): string[] {
  return [
    'gc',
    ...(request.dryRun === false ? ['--apply'] : []),
    ...(request.maxAgeDays !== undefined
      ? ['--max-age-days', String(request.maxAgeDays)]
      : []),
    ...(request.keepTagged === false ? ['--no-keep-tagged'] : []),
    '--json',
  ];
}

export function buildRollbackArgs(request: RollbackRequest): string[] {
  return ['rollback', request.id, '--json'];
}

export function buildLanguageListArgs(): string[] {
  return ['locale', 'list'];
}

export function buildLanguageInstallArgs(
  request: LanguageInstallRequest,
): string[] {
  return [
    'locale',
    'install',
    request.path,
    ...(request.force ? ['--force'] : []),
    ...(request.use ? ['--use'] : []),
  ];
}

export function buildLanguageUseArgs(locale: string): string[] {
  return ['locale', 'use', locale];
}

export function buildLanguageRemoveArgs(locale: string): string[] {
  return ['locale', 'remove', locale];
}
