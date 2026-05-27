import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI = resolve(import.meta.dirname, '..', 'dist', 'cli.js');

function step(label: string): void {
  console.log(`\n--- ${label} ---`);
}

function shinobi(args: string[], env: Record<string, string>): string {
  return execFileSync(process.execPath, [CLI, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const sandbox = mkdtempSync(join(tmpdir(), 'shinobi-cli-smoke-'));
const configDir = join(sandbox, 'config');
const projectCwd = join(sandbox, 'project');
const syncRepo = join(sandbox, 'sync-repo');
const fakeRemote = join(sandbox, 'remote.git');

mkdirSync(projectCwd, { recursive: true });

const dbPath = join(configDir, 'shinobi.db');
const env: Record<string, string> = {
  SHINOBI_CONFIG_DIR: configDir,
  SHINOBI_DB_PATH: dbPath,
};
process.env['SHINOBI_CONFIG_DIR'] = configDir;
process.env['SHINOBI_DB_PATH'] = dbPath;

try {
  step('init');
  const initOut = execFileSync(process.execPath, [CLI, 'init'], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
    cwd: projectCwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log(initOut);

  if (!existsSync(join(configDir, '.env'))) throw new Error('missing .env');
  if (!existsSync(join(configDir, 'config.json'))) throw new Error('missing config.json');
  if (!existsSync(dbPath)) throw new Error('missing db');
  if (!existsSync(join(projectCwd, '.mcp.json'))) throw new Error('missing .mcp.json');
  const mcpJson = JSON.parse(readFileSync(join(projectCwd, '.mcp.json'), 'utf-8')) as {
    mcpServers: { shinobi: { command: string } };
  };
  if (mcpJson.mcpServers.shinobi.command !== 'npx') throw new Error('bad .mcp.json content');
  console.log('init OK: config/db/env/.mcp.json all present');

  step('migrate (idempotent)');
  console.log(shinobi(['migrate'], env));

  step('sync init (creates a local repo + a bare remote)');
  execFileSync('git', ['init', '--bare', fakeRemote], { stdio: 'inherit' });
  console.log(shinobi(['sync', 'init', syncRepo, 'main'], env));
  execFileSync('git', ['-C', syncRepo, 'remote', 'add', 'origin', fakeRemote], { stdio: 'inherit' });
  execFileSync('git', ['-C', syncRepo, 'config', 'user.email', 'smoke@example.com'], { stdio: 'inherit' });
  execFileSync('git', ['-C', syncRepo, 'config', 'user.name', 'Smoke Test'], { stdio: 'inherit' });
  execFileSync('git', ['-C', syncRepo, 'checkout', '-b', 'main'], { stdio: 'inherit' });
  console.log(shinobi(['sync', 'status'], env));

  step('write data via mcp tools (out-of-band: import + call models directly)');
  const { createProject } = await import('../dist/models/projects.js');
  const { closeDb } = await import('../dist/lib/db.js');
  const proj = createProject({ title: 'Sync sentinel', description: 'must round-trip via push/pull' });
  console.log(`created project id=${proj.id}`);
  closeDb();

  step('sync push');
  console.log(shinobi(['sync', 'push'], env));

  step('sync status (should show last_push_at)');
  console.log(shinobi(['sync', 'status'], env));

  step('wipe local DB and pull from sync repo');
  rmSync(dbPath, { force: true });
  if (existsSync(`${dbPath}-shm`)) rmSync(`${dbPath}-shm`, { force: true });
  if (existsSync(`${dbPath}-wal`)) rmSync(`${dbPath}-wal`, { force: true });
  console.log(shinobi(['sync', 'pull'], env));

  step('verify the project came back');
  const { getProject } = await import('../dist/models/projects.js');
  const restored = getProject(proj.id);
  if (!restored || restored.title !== 'Sync sentinel') {
    throw new Error(`restored project mismatch: ${JSON.stringify(restored)}`);
  }
  console.log(`restored project id=${restored.id} title="${restored.title}"`);

  console.log('\nCLI SMOKE OK');
} finally {
  try {
    const { closeDb } = await import('../dist/lib/db.js');
    closeDb();
  } catch {
    // ignore
  }
  rmSync(sandbox, { recursive: true, force: true });
}
