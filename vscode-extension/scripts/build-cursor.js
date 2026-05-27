#!/usr/bin/env node
// Builds a Cursor-flavoured .vsix from the shared source tree. Cursor's
// extension API is fully compatible with VS Code's, so the only delta is
// a separate package.json (different publisher / displayName / keywords)
// so the listing does not collide on the Open VSX-style Cursor marketplace.
//
// Usage: node scripts/build-cursor.js [--output cursor-pkg]

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const outArg = process.argv.indexOf('--output');
const outDir = outArg !== -1 ? path.resolve(root, process.argv[outArg + 1]) : path.resolve(root, 'cursor-pkg');

console.log(`shinobi cursor build → ${outDir}`);

// 1. Clean target dir
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// 2. Copy compiled JS + assets (must run `npm run build` first)
const distSrc = path.join(root, 'dist');
if (!fs.existsSync(distSrc)) {
  console.error('error: dist/ missing. Run `npm run build` first.');
  process.exit(1);
}
copyRecursive(distSrc, path.join(outDir, 'dist'));
fs.copyFileSync(path.join(root, 'README.md'), path.join(outDir, 'README.md'));
if (fs.existsSync(path.join(root, '.vscodeignore'))) {
  fs.copyFileSync(path.join(root, '.vscodeignore'), path.join(outDir, '.vscodeignore'));
}

// 3. Derive Cursor manifest from the base manifest
const base = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const cursor = {
  ...base,
  name: 'shinobi-cursor',
  displayName: 'Shinobi (Cursor edition)',
  description: base.description + ' Built for Cursor; identical to the VS Code build.',
  publisher: 'shinobi',
  keywords: [...(base.keywords ?? []), 'cursor', 'task-tracker', 'mcp'],
  scripts: { 'vscode:prepublish': "echo 'already built'" },
  devDependencies: { vsce: '^2.15.0' },
};
delete cursor.dependencies;
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(cursor, null, 2) + '\n');

console.log('cursor manifest written.');

// 4. Package via vsce
try {
  execSync('npx --yes @vscode/vsce package --no-dependencies', {
    cwd: outDir,
    stdio: 'inherit',
  });
} catch (err) {
  console.error(`vsce package failed: ${err.message}`);
  process.exit(1);
}

const vsix = fs.readdirSync(outDir).find((f) => f.endsWith('.vsix'));
if (vsix) {
  const moved = path.join(root, vsix);
  fs.copyFileSync(path.join(outDir, vsix), moved);
  console.log(`packaged: ${moved}`);
} else {
  console.error('no .vsix produced.');
  process.exit(1);
}

function copyRecursive(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyRecursive(src, dst);
    else fs.copyFileSync(src, dst);
  }
}
