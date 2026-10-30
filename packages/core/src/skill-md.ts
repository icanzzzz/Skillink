import { parse } from 'yaml';

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  metadata: Record<string, string>;
}

function scalarToString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

export function parseSkillFrontmatter(
  content: string,
): SkillFrontmatter | undefined {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return undefined;
  }

  const end = lines.findIndex(
    (line, index) => index > 0 && line === '---',
  );
  if (end === -1) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = parse(lines.slice(1, end).join('\n'));
  } catch {
    return undefined;
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }

  const record = parsed as Record<string, unknown>;
  const result: SkillFrontmatter = { metadata: {} };

  if (typeof record.name === 'string') {
    result.name = record.name;
  }
  if (typeof record.description === 'string') {
    result.description = record.description;
  }

  const metadata = record.metadata;
  if (metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)) {
    for (const [key, value] of Object.entries(metadata)) {
      const scalar = scalarToString(value);
      if (scalar !== undefined) {
        result.metadata[key] = scalar;
      }
    }
  }

  return result;
}
