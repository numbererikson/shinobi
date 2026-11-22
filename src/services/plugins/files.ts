import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { userPluginsDir } from './discovery.js';
import { listLoadedPlugins } from './state.js';

/**
 * Single-file plugins managed from the dashboard: install from a URL or the
 * catalog, check for updates, remove. The source URL and content hash of each
 * file are kept in `<plugins dir>/.sources.json` (ignored by discovery).
 * Installing runs third-party code on the next start, so it is reserved for
 * the dashboard owner (behind dashboard auth) and https URLs.
 */

export const MAX_PLUGIN_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const FILE_NAME = /^[a-z0-9][a-z0-9._-]{0,80}\.m?js$/i;
const DEFAULT_CATALOG_URL = 'https://raw.githubusercontent.com/numbererikson/shinobi-plugin-example/main/catalog.json';
const STARTED_AT = Date.now();
let removedSinceStart = false;

export interface SourceEntry {
  url: string;
  sha256: string;
  installed_at: string;
}

export interface PluginFile {
  file: string;
  url: string | null;
  sha256: string | null;
  installed_at: string | null;
  loaded: boolean;
  error: string | null;
  /** The file changed after this server started: a restart loads it. */
  pending_restart: boolean;
}

export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  url: string;
  installed: boolean;
}

function manifestPath(): string {
  return join(userPluginsDir(), '.sources.json');
}

function readManifest(): Record<string, SourceEntry> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath(), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, SourceEntry>) : {};
  } catch {
    return {};
  }
}

function writeManifest(m: Record<string, SourceEntry>): void {
  mkdirSync(userPluginsDir(), { recursive: true });
  const tmp = manifestPath() + '.tmp';
  writeFileSync(tmp, JSON.stringify(m, null, 2) + '\n', 'utf8');
  renameSync(tmp, manifestPath());
}

/** https anywhere; plain http only to this machine (local development). */
export function checkPluginUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('not a valid URL');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) throw new Error('plugin URLs must use https');
  return u;
}

export function fileNameFromUrl(u: URL): string {
  const base = decodeURIComponent(u.pathname.slice(u.pathname.lastIndexOf('/') + 1));
  if (!FILE_NAME.test(base)) throw new Error(`the URL must point at a single .mjs or .js file (got "${base || '/'}")`);
  return base;
}

function checkFileName(file: string): string {
  if (!FILE_NAME.test(file)) throw new Error(`invalid plugin file name "${file}"`);
  return file;
}

async function download(u: URL): Promise<{ code: string; sha256: string }> {
  let res: Response;
  try {
    res = await fetch(u, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
  } catch (err) {
    throw new Error(`download failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_PLUGIN_BYTES) throw new Error('plugin file is larger than 2 MB');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_PLUGIN_BYTES) throw new Error('plugin file is larger than 2 MB');
  if (buf.length === 0) throw new Error('downloaded file is empty');
  const code = buf.toString('utf8');
  if (!/\bexport\s+(default|function|async\s+function|\{)/.test(code)) {
    throw new Error('this does not look like a plugin module (no export found)');
  }
  return { code, sha256: createHash('sha256').update(buf).digest('hex') };
}

export async function installFromUrl(rawUrl: string): Promise<PluginFile> {
  const u = checkPluginUrl(rawUrl);
  const file = fileNameFromUrl(u);
  const { code, sha256 } = await download(u);
  const dir = userPluginsDir();
  mkdirSync(dir, { recursive: true });
  const target = join(dir, file);
  writeFileSync(target + '.tmp', code, 'utf8');
  renameSync(target + '.tmp', target);
  const m = readManifest();
  m[file] = { url: u.toString(), sha256, installed_at: new Date().toISOString() };
  writeManifest(m);
  return listPluginFiles().find((f) => f.file === file)!;
}

export async function updatePluginFile(file: string): Promise<PluginFile> {
  const entry = readManifest()[checkFileName(file)];
  if (!entry) throw new Error(`${file} was not installed from a URL, so it cannot be updated here`);
  return installFromUrl(entry.url);
}

export function removePluginFile(file: string): boolean {
  checkFileName(file);
  const target = join(userPluginsDir(), file);
  const existed = existsSync(target);
  rmSync(target, { force: true });
  const m = readManifest();
  if (m[file]) {
    delete m[file];
    writeManifest(m);
  }
  if (existed) removedSinceStart = true;
  return existed;
}

export function listPluginFiles(): PluginFile[] {
  const dir = userPluginsDir();
  if (!existsSync(dir)) return [];
  const m = readManifest();
  const loaded = listLoadedPlugins();
  return readdirSync(dir)
    .filter((f) => FILE_NAME.test(f))
    .sort()
    .map((file) => {
      const info = loaded.find((p) => p.name === `user/${file.replace(/\.m?js$/, '')}`);
      let mtime = 0;
      try {
        mtime = statSync(join(dir, file)).mtimeMs;
      } catch {
        mtime = 0;
      }
      const src = m[file];
      return {
        file,
        url: src?.url ?? null,
        sha256: src?.sha256 ?? null,
        installed_at: src?.installed_at ?? null,
        loaded: Boolean(info && !info.error),
        error: info?.error ?? null,
        pending_restart: mtime > STARTED_AT || !info,
      };
    });
}

export function restartNeeded(): boolean {
  return removedSinceStart || listPluginFiles().some((f) => f.pending_restart);
}

export interface UpdateCheck {
  file: string;
  url: string;
  update_available: boolean;
  error: string | null;
}

/** Compare each URL-installed file with what its URL serves now. */
export async function checkPluginUpdates(): Promise<UpdateCheck[]> {
  const m = readManifest();
  return Promise.all(
    Object.entries(m).map(async ([file, entry]) => {
      try {
        const { sha256 } = await download(checkPluginUrl(entry.url));
        return { file, url: entry.url, update_available: sha256 !== entry.sha256, error: null };
      } catch (err) {
        return { file, url: entry.url, update_available: false, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
}

export async function fetchCatalog(url = process.env['SHINOBI_PLUGIN_CATALOG_URL'] || DEFAULT_CATALOG_URL): Promise<CatalogEntry[]> {
  const res = await fetch(checkPluginUrl(url), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`catalog: HTTP ${res.status}`);
  const data = (await res.json()) as { plugins?: unknown };
  const list = Array.isArray(data.plugins) ? data.plugins : [];
  const installedUrls = new Set(Object.values(readManifest()).map((e) => e.url));
  const files = new Set(listPluginFiles().map((f) => f.file));
  return list.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const p = raw as Record<string, unknown>;
    if (typeof p['url'] !== 'string' || typeof p['name'] !== 'string') return [];
    let file = '';
    try {
      file = fileNameFromUrl(checkPluginUrl(p['url']));
    } catch {
      return [];
    }
    return [
      {
        id: typeof p['id'] === 'string' ? p['id'] : file,
        name: p['name'],
        description: typeof p['description'] === 'string' ? p['description'] : '',
        url: p['url'],
        installed: installedUrls.has(p['url']) || files.has(file),
      },
    ];
  });
}

/** True when a supervisor (Docker restart policy) brings the process back after exit. */
export function canSelfRestart(): boolean {
  return existsSync('/.dockerenv') || process.env['SHINOBI_SUPERVISED'] === '1';
}
