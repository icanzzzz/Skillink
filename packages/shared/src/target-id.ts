/**
 * Converts a display value into a target id segment. Shared by the core
 * target command and the GUI so the placeholder preview always matches the
 * id that will be used when the field is left empty.
 */
export function slugifyTargetId(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'target';
}

/** Returns the last path segment for either POSIX or Windows paths. */
export function targetPathBaseName(value: string): string {
  const trimmed = value.trim().replace(/[\\/]+$/u, '');
  return trimmed.split(/[\\/]+/u).filter(Boolean).at(-1) ?? '';
}

export interface TargetIdDefaultInput {
  id?: string;
  label?: string;
  path: string;
}

/**
 * Derives the target id used when the id field is left empty: an explicit id
 * wins, then the label, then the folder name of the target path.
 */
export function deriveTargetIdDefault(input: TargetIdDefaultInput): string {
  const explicit = input.id?.trim();
  if (explicit) {
    return explicit;
  }

  const label = input.label?.trim();
  const source = label || targetPathBaseName(input.path);
  return slugifyTargetId(source);
}
