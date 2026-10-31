import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'out' ||
      entry.name === 'dist' ||
      entry.name === 'release'
    ) {
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

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
    (match) => match[1]!,
  );
}

function isPackage(specifier: string, packageName: string): boolean {
  return (
    specifier === packageName || specifier.startsWith(`${packageName}/`)
  );
}

type Rule = [
  name: string,
  matches: (specifier: string, file: string) => boolean,
];

function resolvesInto(
  file: string,
  specifier: string,
  directory: string,
): boolean {
  if (!specifier.startsWith('.')) {
    return false;
  }
  const resolved = path.resolve(path.dirname(file), specifier);
  return (
    resolved === directory || resolved.startsWith(`${directory}${path.sep}`)
  );
}

async function listDirectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => path.join(dir, entry.name));
}

async function findViolations(
  scope: string,
  rules: Rule[],
  options: { recursive?: boolean } = {},
): Promise<string[]> {
  const root = path.join(repoRoot, scope);
  const files =
    options.recursive === false
      ? await listDirectSourceFiles(root)
      : await listSourceFiles(root);
  const violations: string[] = [];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const specifier of importSpecifiers(source)) {
      for (const [rule, matches] of rules) {
        if (matches(specifier, file)) {
          const relative = path
            .relative(repoRoot, file)
            .split(path.sep)
            .join('/');
          violations.push(`${relative}: ${specifier} (${rule})`);
        }
      }
    }
  }

  return violations;
}

describe('module boundaries', () => {
  it('keeps desktop main and preload free of @skillink/core', async () => {
    const violations = [
      ...(await findViolations('apps/desktop/src/main', [
        ['desktop-core', (specifier) => isPackage(specifier, '@skillink/core')],
      ])),
      ...(await findViolations('apps/desktop/src/preload', [
        ['desktop-core', (specifier) => isPackage(specifier, '@skillink/core')],
      ])),
    ];

    expect(violations).toEqual([]);
  });

  it('prevents core from importing CLI, Electron, or React', async () => {
    const violations = await findViolations('packages/core/src', [
      ['core-cli', (specifier) => isPackage(specifier, '@skillink/cli')],
      ['core-desktop', (specifier) => isPackage(specifier, '@skillink/desktop')],
      ['core-electron', (specifier) => isPackage(specifier, 'electron')],
      ['core-react', (specifier) => isPackage(specifier, 'react')],
      ['core-react', (specifier) => isPackage(specifier, 'react-dom')],
    ]);

    expect(violations).toEqual([]);
  });

  it('keeps shared free of application packages', async () => {
    const violations = await findViolations('packages/shared/src', [
      ['shared-core', (specifier) => isPackage(specifier, '@skillink/core')],
      ['shared-cli', (specifier) => isPackage(specifier, '@skillink/cli')],
      ['shared-desktop', (specifier) => isPackage(specifier, '@skillink/desktop')],
    ]);

    expect(violations).toEqual([]);
  });

  it('prevents CLI from importing Electron or React', async () => {
    const violations = await findViolations('apps/cli/src', [
      ['cli-electron', (specifier) => isPackage(specifier, 'electron')],
      ['cli-react', (specifier) => isPackage(specifier, 'react')],
      ['cli-react', (specifier) => isPackage(specifier, 'react-dom')],
    ]);

    expect(violations).toEqual([]);
  });

  it('prevents renderer from importing Node, Electron, or core', async () => {
    const violations = await findViolations('apps/desktop/src/renderer', [
      ['renderer-core', (specifier) => isPackage(specifier, '@skillink/core')],
      ['renderer-electron', (specifier) => isPackage(specifier, 'electron')],
      ['renderer-node', (specifier) => specifier.startsWith('node:')],
      [
        'renderer-main',
        (specifier, file) =>
          resolvesInto(
            file,
            specifier,
            path.join(repoRoot, 'apps/desktop/src/main'),
          ),
      ],
      [
        'renderer-preload',
        (specifier, file) =>
          resolvesInto(
            file,
            specifier,
            path.join(repoRoot, 'apps/desktop/src/preload'),
          ),
      ],
    ]);

    expect(violations).toEqual([]);
  });

  it('keeps desktop shared modules free of platform-only imports', async () => {
    const violations = await findViolations(
      'apps/desktop/src',
      [
        ['desktop-core', (specifier) => isPackage(specifier, '@skillink/core')],
        ['desktop-electron', (specifier) => isPackage(specifier, 'electron')],
        ['desktop-node', (specifier) => specifier.startsWith('node:')],
      ],
      { recursive: false },
    );

    expect(violations).toEqual([]);
  });

  it('detects renderer imports that escape into main or preload', () => {
    const rendererFile = path.join(
      repoRoot,
      'apps/desktop/src/renderer/src/example.tsx',
    );

    expect(
      resolvesInto(
        rendererFile,
        '../../main/ipc.js',
        path.join(repoRoot, 'apps/desktop/src/main'),
      ),
    ).toBe(true);
    expect(
      resolvesInto(
        rendererFile,
        '../../preload/index.js',
        path.join(repoRoot, 'apps/desktop/src/preload'),
      ),
    ).toBe(true);
    expect(
      resolvesInto(
        rendererFile,
        './local.js',
        path.join(repoRoot, 'apps/desktop/src/main'),
      ),
    ).toBe(false);
  });

  it('declares every workspace cross-package import', async () => {
    const workspaces = [
      'apps/cli',
      'apps/desktop',
      'packages/core',
      'packages/shared',
    ];
    const violations: string[] = [];

    for (const workspace of workspaces) {
      const packageJsonPath = path.join(repoRoot, workspace, 'package.json');
      const packageJson = JSON.parse(
        await readFile(packageJsonPath, 'utf8'),
      ) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      const declared = new Set([
        ...Object.keys(packageJson.dependencies ?? {}),
        ...Object.keys(packageJson.devDependencies ?? {}),
        ...Object.keys(packageJson.peerDependencies ?? {}),
      ]);

      for (const file of await listSourceFiles(
        path.join(repoRoot, workspace, 'src'),
      )) {
        const source = await readFile(file, 'utf8');
        for (const specifier of importSpecifiers(source)) {
          if (!specifier.startsWith('@skillink/')) {
            continue;
          }
          const packageName = specifier.split('/').slice(0, 2).join('/');
          if (declared.has(packageName)) {
            continue;
          }
          const relative = path
            .relative(repoRoot, file)
            .split(path.sep)
            .join('/');
          violations.push(`${relative}: ${specifier} (undeclared)`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
