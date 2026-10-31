import { SkillinkError } from '@skillink/shared';

export function parseSpec(spec: string): { name: string; version: string } {
  const separator = spec.lastIndexOf('@');
  if (separator <= 0 || separator === spec.length - 1) {
    throw new SkillinkError(
      'ROUTE_INVALID',
      'Invalid spec; expected name@version.',
      { spec },
    );
  }

  return {
    name: spec.slice(0, separator),
    version: spec.slice(separator + 1),
  };
}

export function asArray(value: string[] | string | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export function collectSpecs(
  specs: string[] | string | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const spec of asArray(specs)) {
    const parsed = parseSpec(spec);
    result[parsed.name] = parsed.version;
  }

  return result;
}
