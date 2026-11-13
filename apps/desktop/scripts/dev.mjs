#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const electronViteRoot = path.dirname(require.resolve('electron-vite/package.json'));
const electronViteBin = path.join(electronViteRoot, 'bin', 'electron-vite.js');

/** `0x80000003` (STATUS_BREAKPOINT) as reported by Windows for a 32-bit exit code. */
const STATUS_BREAKPOINT = -2147483645;

function runElectronVite(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [electronViteBin, 'dev'], {
      stdio: 'inherit',
      env,
    });
    child.on('error', (error) => {
      console.error('[skillink] unable to start electron-vite:', error);
      resolve({ code: 1, signal: null });
    });
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
}

const first = await runElectronVite(process.env);

if (first.code !== STATUS_BREAKPOINT) {
  process.exit(first.code ?? 1);
}

console.warn('');
console.warn('[skillink] Electron exited with 0x80000003 (STATUS_BREAKPOINT) before any');
console.warn('[skillink] application code ran, which means the Chromium sandbox could not');
console.warn('[skillink] be initialised on this machine.');
console.warn('[skillink] Retrying once with --no-sandbox (development only, never in a build).');
console.warn('');

const retry = await runElectronVite({ ...process.env, NO_SANDBOX: '1' });
process.exit(retry.code ?? 1);
