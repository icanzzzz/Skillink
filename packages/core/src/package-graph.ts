import { createHash } from 'node:crypto';
import {
  SkillinkError,
  type PackageFile,
  type PackageVersion,
  type SkillFile,
  type SkillVersion,
} from '@skillink/shared';
import { stableStringify } from './json-store.js';

export interface PackageRef {
  name: string;
  version: string;
}

export interface ResolvedPackageNode {
  name: string;
  version: string;
  entry: PackageVersion;
}

export interface ResolvedSkill {
  name: string;
  version: string;
  entry: SkillVersion;
  requiredBy: string[];
}

export interface PackageResolution {
  packages: Map<string, ResolvedPackageNode>;
  skills: Map<string, ResolvedSkill>;
}

function nodeId(ref: PackageRef): string {
  return `${ref.name}@${ref.version}`;
}

function getPackageVersion(
  packages: PackageFile,
  ref: PackageRef,
): PackageVersion {
  const entry = Object.hasOwn(packages.packages, ref.name)
    ? packages.packages[ref.name]
    : undefined;
  if (!entry) {
    throw new SkillinkError(
      'PACKAGE_NOT_FOUND',
      `Package "${ref.name}" is not defined in package.json.`,
      { name: ref.name },
    );
  }

  const version = Object.hasOwn(entry.versions, ref.version)
    ? entry.versions[ref.version]
    : undefined;
  if (!version) {
    throw new SkillinkError(
      'VERSION_NOT_FOUND',
      `Version "${ref.version}" of package "${ref.name}" is not defined in package.json.`,
      { name: ref.name, version: ref.version },
    );
  }

  if (
    Object.keys(version.packages).length + Object.keys(version.skills).length ===
    0
  ) {
    throw new SkillinkError(
      'PACKAGE_EMPTY',
      `Package ${nodeId(ref)} must contain at least one package or skill.`,
      { name: ref.name, version: ref.version },
    );
  }

  return version;
}

function cycleError(path: string[], id: string): SkillinkError {
  const start = path.indexOf(id);
  const cyclePath = [...path.slice(start === -1 ? 0 : start), id];
  return new SkillinkError(
    'PACKAGE_CYCLE',
    `Package cycle detected: ${cyclePath.join(' -> ')}`,
    { path: cyclePath },
  );
}

export function resolvePackageGraph(
  packages: PackageFile,
  skills: SkillFile,
  roots: PackageRef[],
): PackageResolution {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  const resolvedPackages = new Map<string, ResolvedPackageNode>();
  const resolvedSkills = new Map<string, ResolvedSkill>();

  function visit(ref: PackageRef): void {
    const id = nodeId(ref);

    if (visiting.has(id)) {
      throw cycleError(path, id);
    }
    if (visited.has(id)) {
      return;
    }

    visiting.add(id);
    path.push(id);

    const entry = getPackageVersion(packages, ref);

    for (const [skillName, skillVersion] of Object.entries(entry.skills)) {
      const skillEntry =
        Object.hasOwn(skills.skills, skillName) &&
        Object.hasOwn(skills.skills[skillName]!.versions, skillVersion)
          ? skills.skills[skillName]!.versions[skillVersion]
          : undefined;
      if (!skillEntry) {
        throw new SkillinkError(
          'VERSION_NOT_FOUND',
          `Skill "${skillName}" version "${skillVersion}" is not defined in skill.json.`,
          { skillName, version: skillVersion, requiredBy: id },
        );
      }

      const existing = resolvedSkills.get(skillName);
      if (existing && existing.version !== skillVersion) {
        throw new SkillinkError(
          'SKILL_VERSION_CONFLICT',
          `Skill "${skillName}" is required at ${existing.version} by ${existing.requiredBy.join(', ')} and at ${skillVersion} by ${id}.`,
          {
            skillName,
            versions: [existing.version, skillVersion],
            requiredBy: [...existing.requiredBy, id],
          },
        );
      }

      if (existing) {
        if (!existing.requiredBy.includes(id)) {
          existing.requiredBy.push(id);
        }
      } else {
        resolvedSkills.set(skillName, {
          name: skillName,
          version: skillVersion,
          entry: skillEntry,
          requiredBy: [id],
        });
      }
    }

    for (const [packageName, packageVersion] of Object.entries(entry.packages)) {
      visit({ name: packageName, version: packageVersion });
    }

    path.pop();
    visiting.delete(id);
    visited.add(id);
    resolvedPackages.set(id, {
      name: ref.name,
      version: ref.version,
      entry,
    });
  }

  for (const root of roots) {
    visit(root);
  }

  return { packages: resolvedPackages, skills: resolvedSkills };
}

export function computePackageIntegrity(
  packages: PackageFile,
  roots: PackageRef[],
): string {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  const nodes = new Map<string, ResolvedPackageNode>();

  function visit(ref: PackageRef): void {
    const id = nodeId(ref);

    if (visiting.has(id)) {
      throw cycleError(path, id);
    }
    if (visited.has(id)) {
      return;
    }

    visiting.add(id);
    path.push(id);
    const entry = getPackageVersion(packages, ref);

    for (const [packageName, packageVersion] of Object.entries(entry.packages)) {
      visit({ name: packageName, version: packageVersion });
    }

    path.pop();
    visiting.delete(id);
    visited.add(id);
    nodes.set(id, { name: ref.name, version: ref.version, entry });
  }

  for (const root of roots) {
    visit(root);
  }

  const payload = [...nodes.keys()]
    .sort((left, right) => left.localeCompare(right))
    .map((id) => {
      const node = nodes.get(id)!;
      return stableStringify({
        name: node.name,
        version: node.version,
        entry: node.entry,
      });
    })
    .join('\n');

  const digest = createHash('sha256').update(payload).digest('base64');
  return `sha256-${digest}`;
}

export function validateAllPackages(
  packages: PackageFile,
  skills: SkillFile,
): void {
  for (const [name, entry] of Object.entries(packages.packages)) {
    const versions = Object.keys(entry.versions);
    if (versions.length === 0) {
      throw new SkillinkError(
        'PACKAGE_EMPTY',
        `Package "${name}" must contain at least one version.`,
        { name },
      );
    }

    for (const version of versions) {
      resolvePackageGraph(packages, skills, [{ name, version }]);
    }
  }
}

export function collectPackageSkillRefs(
  packages: PackageFile,
  roots: PackageRef[],
): Set<string> {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  const refs = new Set<string>();

  function visit(ref: PackageRef): void {
    const id = nodeId(ref);

    if (visiting.has(id)) {
      throw cycleError(path, id);
    }
    if (visited.has(id)) {
      return;
    }

    visiting.add(id);
    path.push(id);
    const entry = getPackageVersion(packages, ref);

    for (const [skillName, skillVersion] of Object.entries(entry.skills)) {
      refs.add(`${skillName}@${skillVersion}`);
    }

    for (const [packageName, packageVersion] of Object.entries(entry.packages)) {
      visit({ name: packageName, version: packageVersion });
    }

    path.pop();
    visiting.delete(id);
    visited.add(id);
  }

  for (const root of roots) {
    visit(root);
  }

  return refs;
}
