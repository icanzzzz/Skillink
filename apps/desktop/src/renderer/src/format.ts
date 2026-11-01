import type { Translator } from '@skillink/shared';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function compositionText(
  value: { skills: Record<string, string>; packages: Record<string, string> },
  t: Translator['t'],
  keys: { skills: string; packages: string },
): string {
  const parts: string[] = [];
  if (Object.keys(value.skills).length > 0) {
    parts.push(
      `${t(keys.skills)}: ${Object.entries(value.skills)
        .map(([name, version]) => `${name}@${version}`)
        .join(', ')}`,
    );
  }
  if (Object.keys(value.packages).length > 0) {
    parts.push(
      `${t(keys.packages)}: ${Object.entries(value.packages)
        .map(([name, version]) => `${name}@${version}`)
        .join(', ')}`,
    );
  }
  return parts.join('; ');
}
