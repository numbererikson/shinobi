// Plugin marketplace: queries the public npm registry for shinobi plugin
// packages, installs/uninstalls them into ~/.shinobi/plugins-npm/, exposes
// metadata for the dashboard UI.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stderr } from 'node:process';

const NPM_REGISTRY = 'https://registry.npmjs.org';

export interface MarketplacePackage {
  name: string;
  description: string;
  version: string;
  author: string | null;
  date: string | null;
  links: { npm?: string; homepage?: string; repository?: string };
  installed: boolean;
}

export interface InstallResult {
  ok: boolean;
  pkg: string;
  stdout: string;
  stderr: string;
  duration_ms: number;
  prefix: string;
}

export function pluginsNpmDir(): string {
  const override = process.env['SHINOBI_PLUGINS_NPM_DIR'];
  if (override && override.length > 0) return override;
  return join(homedir(), '.shinobi', 'plugins-npm');
}

interface NpmSearchHit {
  package: {
    name: string;
    description?: string;
    version: string;
    date?: string;
    author?: { name?: string };
    publisher?: { username?: string };
    links?: { npm?: string; homepage?: string; repository?: string };
  };
}

interface NpmSearchResponse {
  objects: NpmSearchHit[];
}

/**
 * Search the npm registry for shinobi plugins.
 *
 * Tries `@shinobi/plugin-*` (scoped) and `shinobi-plugin-*` (unscoped)
 * naming patterns in one query each, dedupes, and marks already-installed
 * packages.
 */
export async function searchMarketplace(query: string): Promise<MarketplacePackage[]> {
  const queries = [
    `${query} keywords:shinobi-plugin`,
    `@shinobi/plugin-${query}`,
    `shinobi-plugin-${query}`,
  ];
  const seen = new Map<string, MarketplacePackage>();
  for (const q of queries) {
    const url = `${NPM_REGISTRY}/-/v1/search?text=${encodeURIComponent(q)}&size=20`;
    let response: Response;
    try {
      response = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch (err) {
      stderr.write(`marketplace search "${q}" failed: ${err instanceof Error ? err.message : String(err)}\n`);
      continue;
    }
    if (!response.ok) continue;
    const json = (await response.json()) as NpmSearchResponse;
    for (const hit of json.objects) {
      const name = hit.package.name;
      if (!isShinobiPlugin(name)) continue;
      if (seen.has(name)) continue;
      seen.set(name, {
        name,
        description: hit.package.description ?? '',
        version: hit.package.version,
        author: hit.package.author?.name ?? hit.package.publisher?.username ?? null,
        date: hit.package.date ?? null,
        links: hit.package.links ?? {},
        installed: isInstalled(name),
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function isShinobiPlugin(name: string): boolean {
  return name.startsWith('@shinobi/plugin-') || name.startsWith('shinobi-plugin-');
}

export function isInstalled(name: string): boolean {
  return existsSync(join(pluginsNpmDir(), 'node_modules', name, 'package.json'));
}

export interface InstalledPackage {
  name: string;
  version: string;
  description: string;
  module_path: string;
}

export function listInstalled(): InstalledPackage[] {
  const dir = join(pluginsNpmDir(), 'node_modules');
  if (!existsSync(dir)) return [];
  const out: InstalledPackage[] = [];
  walkScope(dir, '', out);
  walkScope(dir, '@shinobi', out);
  return out;
}

function walkScope(nodeModulesDir: string, scope: string, out: InstalledPackage[]): void {
  const base = scope ? join(nodeModulesDir, scope) : nodeModulesDir;
  if (!existsSync(base)) return;
  let entries: string[];
  try {
    entries = readdirSync(base);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!scope && entry.startsWith('@')) continue;
    const fullName = scope ? `${scope}/${entry}` : entry;
    if (!isShinobiPlugin(fullName)) continue;
    const pkgJsonPath = join(base, entry, 'package.json');
    if (!existsSync(pkgJsonPath)) continue;
    let pkg: { name?: string; version?: string; description?: string; main?: string };
    try {
      pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    } catch {
      continue;
    }
    out.push({
      name: pkg.name ?? fullName,
      version: pkg.version ?? 'unknown',
      description: pkg.description ?? '',
      module_path: join(base, entry, pkg.main ?? 'index.js'),
    });
  }
}

export async function installPackage(name: string): Promise<InstallResult> {
  if (!isShinobiPlugin(name)) {
    return {
      ok: false,
      pkg: name,
      stdout: '',
      stderr: `package "${name}" does not match shinobi plugin naming pattern (@shinobi/plugin-* or shinobi-plugin-*)`,
      duration_ms: 0,
      prefix: pluginsNpmDir(),
    };
  }
  const prefix = pluginsNpmDir();
  mkdirSync(prefix, { recursive: true });
  // Ensure a package.json exists so npm doesn't complain about parent traversal.
  const pkgManifest = join(prefix, 'package.json');
  if (!existsSync(pkgManifest)) {
    writeFileSync(
      pkgManifest,
      JSON.stringify({ name: 'shinobi-plugins-host', version: '1.0.0', private: true }, null, 2),
    );
  }
  return runNpm(['install', '--no-audit', '--no-fund', name], prefix, name);
}

export async function uninstallPackage(name: string): Promise<InstallResult> {
  const prefix = pluginsNpmDir();
  if (!isShinobiPlugin(name)) {
    return {
      ok: false,
      pkg: name,
      stdout: '',
      stderr: `refusing to uninstall non-shinobi package: ${name}`,
      duration_ms: 0,
      prefix,
    };
  }
  if (!existsSync(prefix)) {
    return { ok: true, pkg: name, stdout: 'nothing to uninstall', stderr: '', duration_ms: 0, prefix };
  }
  return runNpm(['uninstall', '--no-audit', '--no-fund', name], prefix, name);
}

function runNpm(args: string[], cwd: string, pkg: string): Promise<InstallResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const proc = spawn(npmCmd, args, { cwd, shell: false });
    let stdout = '';
    let stderrOut = '';
    proc.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    proc.stderr?.on('data', (chunk: Buffer) => (stderrOut += chunk.toString()));
    proc.on('close', (code) => {
      resolve({
        ok: code === 0,
        pkg,
        stdout: stdout.slice(-5000),
        stderr: stderrOut.slice(-5000),
        duration_ms: Date.now() - startedAt,
        prefix: cwd,
      });
    });
    proc.on('error', (err) => {
      resolve({
        ok: false,
        pkg,
        stdout,
        stderr: stderrOut + '\nspawn error: ' + err.message,
        duration_ms: Date.now() - startedAt,
        prefix: cwd,
      });
    });
  });
}

export function purgeInstallCache(): void {
  const dir = pluginsNpmDir();
  if (!existsSync(dir)) return;
  rmSync(dir, { recursive: true, force: true });
}
