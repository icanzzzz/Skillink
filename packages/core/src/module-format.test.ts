import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const WORKSPACES = [
  'apps/cli',
  'apps/desktop',
  'packages/core',
  'packages/shared',
] as const;

const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'out',
  'dist',
  'release',
  'coverage',
]);

const RELATIVE_IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)['"](\.[^'"]*)['"]/g;
const RESOLVABLE_EXTENSION = /\.(?:js|cjs|mjs|json|css)$/;

interface WorkspaceManifest {
  name?: string;
  type?: string;
  main?: string;
}

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(full)));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

async function listCommonJsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listCommonJsFiles(full)));
    } else if (/\.(cjs|cts)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

async function readManifest(
  workspace: string,
): Promise<WorkspaceManifest> {
  const raw = await readFile(
    path.join(repoRoot, workspace, 'package.json'),
    'utf8',
  );
  return JSON.parse(raw) as WorkspaceManifest;
}

function relative(file: string): string {
  return path.relative(repoRoot, file).replaceAll('\\', '/');
}

describe('module format', () => {
  it('declares every workspace as an ES module', async () => {
    const offenders: string[] = [];
    for (const workspace of WORKSPACES) {
      const manifest = await readManifest(workspace);
      if (manifest.type !== 'module') {
        offenders.push(`${workspace} (type=${manifest.type ?? 'undefined'})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('points the desktop entry at an ESM .js file', async () => {
    const manifest = await readManifest('apps/desktop');
    expect(manifest.main).toBe('./out/main/index.js');
    for (const workspace of WORKSPACES) {
      const entry = (await readManifest(workspace)).main;
      expect(entry).toBeDefined();
      expect(entry).not.toMatch(/\.(?:cjs|mjs)$/);
    }
  });

  it('uses .js extensions for every relative import', async () => {
    const offenders: string[] = [];
    for (const workspace of WORKSPACES) {
      for (const file of await listSourceFiles(
        path.join(repoRoot, workspace),
      )) {
        const source = await readFile(file, 'utf8');
        for (const match of source.matchAll(RELATIVE_IMPORT)) {
          const specifier = match[1]!;
          if (!RESOLVABLE_EXTENSION.test(specifier)) {
            offenders.push(`${relative(file)} -> ${specifier}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps CommonJS out of the source tree', async () => {
    const offenders: string[] = [];
    for (const workspace of WORKSPACES) {
      for (const file of await listCommonJsFiles(
        path.join(repoRoot, workspace),
      )) {
        offenders.push(relative(file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('routes the only CommonJS output through the preload entry', async () => {
    const main = await readFile(
      path.join(repoRoot, 'apps/desktop/src/main/index.ts'),
      'utf8',
    );
    const preloadReferences = [...main.matchAll(/['"]([^'"]*index\.cjs)['"]/g)];
    expect(preloadReferences).toHaveLength(1);
    expect(preloadReferences[0]![1]).toBe('index.cjs');

    const config = await readFile(
      path.join(repoRoot, 'apps/desktop/electron.vite.config.ts'),
      'utf8',
    );
    const formats = [...config.matchAll(/format:\s*'([^']+)'/g)].map(
      (match) => match[1],
    );
    expect(formats).toEqual(['cjs']);
  });
});
