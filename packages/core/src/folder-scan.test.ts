import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanFolder } from './folder-scan.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('scanFolder limits', () => {
  it('rejects a folder that exceeds the byte limit', async () => {
    const root = await tempDir('skillink-scan-bytes-');
    await writeFile(path.join(root, 'SKILL.md'), '12345', 'utf8');

    await expect(scanFolder(root, { maxBytes: 4 })).rejects.toMatchObject({
      code: 'IMPORT_LIMIT_EXCEEDED',
      details: expect.objectContaining({ maxBytes: 4 }),
    });
  });

  it('rejects a folder that exceeds the depth limit', async () => {
    const root = await tempDir('skillink-scan-depth-');
    await mkdir(path.join(root, 'one', 'two'), { recursive: true });
    await writeFile(path.join(root, 'SKILL.md'), '# demo', 'utf8');

    await expect(scanFolder(root, { maxDepth: 1 })).rejects.toMatchObject({
      code: 'IMPORT_LIMIT_EXCEEDED',
      details: expect.objectContaining({ maxDepth: 1 }),
    });
  });
});
