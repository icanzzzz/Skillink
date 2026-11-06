import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { readJsonFile, writeJsonAtomic } from './json-store.js';

const TestSchema = z.object({
  schemaVersion: z.literal(1),
  value: z.string(),
});

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'skillink-json-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('atomic JSON store', () => {
  it('writes valid JSON and creates parent directories', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'nested', 'data.json');

    await writeJsonAtomic(file, { schemaVersion: 1, value: 'hello' }, TestSchema);

    const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;
    expect(parsed).toEqual({ schemaVersion: 1, value: 'hello' });
  });

  it('writes keys in a stable order', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'data.json');

    await writeJsonAtomic(file, { value: 'hello', schemaVersion: 1 }, TestSchema);

    expect(await readFile(file, 'utf8')).toBe(
      '{\n  "schemaVersion": 1,\n  "value": "hello"\n}\n',
    );
  });

  it('rejects invalid values before writing', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'data.json');

    await expect(
      writeJsonAtomic(file, { schemaVersion: 1, value: 42 }, TestSchema as never),
    ).rejects.toThrow();
  });

  it('returns the fallback when the file does not exist', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'missing.json');

    await expect(
      readJsonFile(file, TestSchema, { schemaVersion: 1, value: 'fallback' }),
    ).resolves.toEqual({ schemaVersion: 1, value: 'fallback' });
  });

  it('reads an existing valid file', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'data.json');
    await writeJsonAtomic(file, { schemaVersion: 1, value: 'hello' }, TestSchema);

    await expect(
      readJsonFile(file, TestSchema, { schemaVersion: 1, value: 'fallback' }),
    ).resolves.toEqual({ schemaVersion: 1, value: 'hello' });
  });

  it('wraps schema-invalid JSON in an IO_ERROR', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'data.json');
    await writeFile(file, JSON.stringify({ n: 'x' }), 'utf8');

    await expect(
      readJsonFile(file, z.object({ n: z.number() }), { n: 0 }),
    ).rejects.toMatchObject({
      code: 'IO_ERROR',
      details: { filePath: file },
    });
  });
});
