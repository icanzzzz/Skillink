import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SkillinkError } from '@skillink/shared';

export interface JsonSchema<T> {
  parse(value: unknown): T;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, sortKeys(object[key])]),
    );
  }

  return value;
}

export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

export async function readJsonFile<T>(
  filePath: string,
  schema: JsonSchema<T>,
  fallback: T,
): Promise<T> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return fallback;
    }

    throw new SkillinkError(
      'IO_ERROR',
      `Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      { filePath },
      { cause: error },
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new SkillinkError(
      'IO_ERROR',
      `Invalid JSON in ${filePath}`,
      { filePath },
      { cause: error },
    );
  }

  return schema.parse(raw);
}

export async function writeJsonAtomic<T>(
  filePath: string,
  value: T,
  schema: JsonSchema<T>,
): Promise<void> {
  const parsed = schema.parse(value);
  const text = stableStringify(parsed);
  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  await mkdir(directory, { recursive: true });

  try {
    await writeFile(tempPath, text, 'utf8');
    await rename(tempPath, filePath);
  } catch (error) {
    if (isNodeError(error) && (error.code === 'EEXIST' || error.code === 'EPERM')) {
      await rm(filePath, { force: true });
      await rename(tempPath, filePath);
      return;
    }

    await rm(tempPath, { force: true });
    throw new SkillinkError(
      'IO_ERROR',
      `Failed to write ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      { filePath },
      { cause: error },
    );
  }
}
