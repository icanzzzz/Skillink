import { SkillinkError, parseNameVersionSpec } from '@skillink/shared';

export function parseSpec(spec: string): { name: string; version: string } {
  const parsed = parseNameVersionSpec(spec);
  if (!parsed) {
    throw new SkillinkError(
      'ROUTE_INVALID',
      'Invalid spec; expected name@version.',
      { spec },
    );
  }
  return parsed;
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
