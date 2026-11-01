import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from './run.js';

const currentFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (entryFile === path.resolve(currentFile)) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
