#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const electronViteRoot = path.dirname(require.resolve('electron-vite/package.json'));
const electronViteBin = path.join(electronViteRoot, 'bin', 'electron-vite.js');

/**
 * `0x80000003` (STATUS_BREAKPOINT). Windows surfaces it as a 32-bit status code,
 * which Node may report either signed (-2147483645) or unsigned (2147483651), so
 * every comparison goes through `toInt32`.
 */
const STATUS_BREAKPOINT = -2147483645;

function toInt32(code) {
  return code === null || code === undefined ? null : code | 0;
}

function isSandboxBreakpoint(code) {
  return toInt32(code) === STATUS_BREAKPOINT;
}

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

if (first.signal || !isSandboxBreakpoint(first.code)) {
  process.exitCode = toInt32(first.code) ?? 1;
} else {
  console.warn('');
  console.warn('[skillink] Electron exited with 0x80000003 (STATUS_BREAKPOINT) before any');
  console.warn('[skillink] application code ran, so the Chromium sandbox could not be');
  console.warn('[skillink] initialised on this machine.');
  console.warn('[skillink] Retrying once with --no-sandbox (development only; never in a build).');
  console.warn('');

  const retry = await runElectronVite({ ...process.env, NO_SANDBOX: '1' });

  if (isSandboxBreakpoint(retry.code)) {
    console.error('[skillink] The retry with --no-sandbox crashed the same way.');
    console.error('[skillink] This is not an application bug; run the app on a machine where');
    console.error('[skillink] Chromium can start, or check for security software blocking it.');
  }

  process.exitCode = toInt32(retry.code) ?? (retry.signal ? 1 : 0);
}
