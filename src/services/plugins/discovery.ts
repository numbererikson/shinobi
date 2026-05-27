import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stderr } from 'node:process';

export interface PluginCandidate {
  name: string;
  source: 'user' | 'npm';
  module_path: string;
}

function userPluginsDir(): string {
  const override = process.env['SHINOBI_PLUGINS_DIR'];
  if (override && override.length > 0) return override;
  return join(homedir(), '.shinobi', 'plugins');
}

function scanUserPlugins(): PluginCandidate[] {
  const dir = userPluginsDir();
  if (!existsSync(dir)) return [];

  const out: PluginCandidate[] = [];
  for (const entry of readdirSync(dir)) {
    if (!(entry.endsWith('.js') || entry.endsWith('.mjs'))) continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (!stats.isFile()) continue;
    const baseName = entry.replace(/\.(m?js)$/, '');
    out.push({
      name: `user/${baseName}`,
      source: 'user',
      module_path: pathToFileURL(full).href,
    });
  }
  return out;
}

function npmPluginsHostDir(): string {
  const override = process.env['SHINOBI_PLUGINS_NPM_DIR'];
  if (override && override.length > 0) return override;
  return join(homedir(), '.shinobi', 'plugins-npm');
}

function scanNpmPlugins(): PluginCandidate[] {
  // Scan both the marketplace-managed dir (~/.shinobi/plugins-npm/node_modules)
  // and the local-dev node_modules to keep cwd-local plugin development working.
  const roots = [
    join(npmPluginsHostDir(), 'node_modules'),
    join(process.cwd(), 'node_modules'),
  ];
  const out: PluginCandidate[] = [];
  for (const root of roots) {
    scanScope(root, '@shinobi', out);
    scanFlat(root, out);
  }
  return out;
}

function scanScope(nodeModulesDir: string, scope: string, out: PluginCandidate[]): void {
  const scopeDir = join(nodeModulesDir, scope);
  if (!existsSync(scopeDir)) return;
  for (const entry of readdirSync(scopeDir)) {
    if (!entry.startsWith('plugin-')) continue;
    addCandidate(`${scope}/${entry}`, join(scopeDir, entry), out);
  }
}

function scanFlat(nodeModulesDir: string, out: PluginCandidate[]): void {
  if (!existsSync(nodeModulesDir)) return;
  for (const entry of readdirSync(nodeModulesDir)) {
    if (entry.startsWith('@')) continue;
    if (!entry.startsWith('shinobi-plugin-')) continue;
    addCandidate(entry, join(nodeModulesDir, entry), out);
  }
}

function addCandidate(name: string, pkgDir: string, out: PluginCandidate[]): void {
  if (out.some((c) => c.name === name)) return; // dedupe across roots
  const pkgJson = join(pkgDir, 'package.json');
  if (!existsSync(pkgJson)) return;
  let pkg: { main?: string; exports?: { '.'?: { import?: string } } };
  try {
    pkg = JSON.parse(readFileSync(pkgJson, 'utf-8'));
  } catch (err) {
    stderr.write(`shinobi plugin scan: ${name} malformed package.json: ${err instanceof Error ? err.message : String(err)}\n`);
    return;
  }
  const exportEntry = pkg.exports?.['.']?.import;
  const mainFile = typeof exportEntry === 'string' ? exportEntry : pkg.main ?? 'index.js';
  const fullPath = join(pkgDir, mainFile);
  if (!existsSync(fullPath)) return;
  out.push({ name, source: 'npm', module_path: pathToFileURL(fullPath).href });
}

export async function discoverPlugins(): Promise<PluginCandidate[]> {
  return [...scanUserPlugins(), ...scanNpmPlugins()];
}
