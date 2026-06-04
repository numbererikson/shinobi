#!/usr/bin/env node
// Runs as the package `prepare` lifecycle script.
// - Skips if dist/cli.js already exists (publish flow leaves it in place).
// - Skips on recursion via SHINOBI_PREPARE_RUNNING env var. The previous
//   inline `node -e "..." || (npm install ...)` form recursed through cmd.exe
//   on Windows when nested npm invocations dropped node from PATH, looping
//   ~25 levels deep before bailing out.
// - Otherwise installs dashboard-spa deps + builds dist.

import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (existsSync(path.join(root, 'dist/cli.js'))) {
  process.exit(0);
}

if (process.env.SHINOBI_PREPARE_RUNNING === '1') {
  process.exit(0);
}

const env = { ...process.env, SHINOBI_PREPARE_RUNNING: '1' };
const opts = { cwd: root, stdio: 'inherit', shell: true, env };

console.log('shinobi: dist/ missing — bootstrapping (install dashboard-spa deps + build)…');
execSync('npm install --prefix dashboard-spa --no-audit --no-fund', opts);
execSync('npm run build', opts);
