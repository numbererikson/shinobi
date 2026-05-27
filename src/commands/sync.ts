import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { stderr, stdout } from 'node:process';
import { closeDb, getDb, getDbPath } from '../lib/db.js';
import { loadConfig, patchConfig } from '../lib/config.js';
import { broadcastSyncAvailable } from '../services/relay/client.js';

const SNAPSHOT_NAME = 'shinobi.db';

function git(repo: string, args: string[]): string {
  const opts: ExecFileSyncOptionsWithStringEncoding = {
    cwd: repo,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  return execFileSync('git', args, opts).trim();
}

function tryGit(repo: string, args: string[]): { stdout: string; ok: boolean; err?: string } {
  try {
    return { stdout: git(repo, args), ok: true };
  } catch (err) {
    return {
      stdout: '',
      ok: false,
      err: err instanceof Error ? err.message : String(err),
    };
  }
}

function assertGitRepo(repo: string): void {
  if (!existsSync(repo)) {
    throw new Error(`sync repo path does not exist: ${repo}`);
  }
  const result = tryGit(repo, ['rev-parse', '--git-dir']);
  if (!result.ok) {
    throw new Error(`${repo} is not a git repository. Initialize it with: git init && git remote add origin <url>`);
  }
}

function requireSyncConfig(): { repo_path: string; branch: string } {
  const config = loadConfig();
  if (!config.sync) {
    throw new Error('sync is not configured. Run: shinobi sync init <repo-path> [branch]');
  }
  return config.sync;
}

export function syncInit(repoPath: string, branch = 'main'): void {
  const absolute = resolve(repoPath);
  if (!existsSync(absolute)) {
    mkdirSync(absolute, { recursive: true });
    git(absolute, ['init']);
    stdout.write(`initialized empty git repo at ${absolute}\n`);
  } else {
    assertGitRepo(absolute);
  }

  patchConfig({
    sync: {
      repo_path: absolute,
      branch,
      last_push_at: null,
      last_pull_at: null,
    },
  });
  stdout.write(`sync configured: repo=${absolute} branch=${branch}\n`);
  stdout.write(`next: add a remote in the repo if you have not yet, then run \`shinobi sync push\`.\n`);
}

export async function syncPush(): Promise<void> {
  const config = requireSyncConfig();
  assertGitRepo(config.repo_path);

  const snapshotTarget = join(config.repo_path, SNAPSHOT_NAME);
  mkdirSync(dirname(snapshotTarget), { recursive: true });

  const db = getDb();
  db.pragma('wal_checkpoint(TRUNCATE)');
  await db.backup(snapshotTarget);
  // Note: do NOT closeDb() here. CLI exits after this anyway, dashboard needs the
  // singleton to keep serving requests. better-sqlite3 backup is online — the WAL
  // checkpoint above ensures the snapshot is consistent.
  stderr.write(`snapshot written: ${snapshotTarget} (${statSync(snapshotTarget).size} bytes)\n`);

  git(config.repo_path, ['add', SNAPSHOT_NAME]);

  const statusOut = git(config.repo_path, ['status', '--porcelain']);
  if (statusOut === '') {
    stdout.write('no changes to push (snapshot identical to last push)\n');
    patchConfig({ sync: { ...config, last_push_at: new Date().toISOString() } });
    return;
  }

  const message = `shinobi sync push ${new Date().toISOString()}`;
  git(config.repo_path, ['commit', '-m', message]);

  const remoteCheck = tryGit(config.repo_path, ['remote']);
  if (remoteCheck.ok && remoteCheck.stdout !== '') {
    const pushResult = tryGit(config.repo_path, ['push', '-u', 'origin', config.branch]);
    if (!pushResult.ok) {
      stderr.write(`push to remote failed (commit landed locally):\n${pushResult.err}\n`);
    } else {
      stdout.write(`pushed to origin/${config.branch}\n`);
    }
  } else {
    stdout.write(`committed locally; no remote configured. Add one with: git -C ${config.repo_path} remote add origin <url>\n`);
  }

  patchConfig({ sync: { ...config, last_push_at: new Date().toISOString() } });

  // Notify other connected agents (if relay is configured) that a fresh
  // snapshot is now available on the remote. They will auto-pull.
  try {
    broadcastSyncAvailable({ source: 'sync-push', ts: new Date().toISOString() });
  } catch {
    // relay is best-effort, never fail push because of it
  }
}

export function syncPull(): void {
  const config = requireSyncConfig();
  assertGitRepo(config.repo_path);

  const remoteCheck = tryGit(config.repo_path, ['remote']);
  if (remoteCheck.ok && remoteCheck.stdout !== '') {
    const pull = tryGit(config.repo_path, ['pull', 'origin', config.branch]);
    if (!pull.ok) {
      stderr.write(`pull from remote failed:\n${pull.err}\nfalling back to local snapshot\n`);
    }
  } else {
    stderr.write(`no remote configured; restoring from local repo snapshot only\n`);
  }

  const snapshot = join(config.repo_path, SNAPSHOT_NAME);
  if (!existsSync(snapshot)) {
    throw new Error(`no snapshot at ${snapshot}. Run \`shinobi sync push\` on the source machine first.`);
  }

  closeDb();
  const dbPath = getDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });

  if (existsSync(dbPath)) {
    const backupPath = `${dbPath}.bak-${Date.now()}`;
    copyFileSync(dbPath, backupPath);
    stderr.write(`pre-restore backup: ${backupPath}\n`);
  }

  copyFileSync(snapshot, dbPath);
  stdout.write(`restored ${dbPath} from ${snapshot}\n`);

  patchConfig({ sync: { ...config, last_pull_at: new Date().toISOString() } });
}

export function syncStatus(): void {
  const config = loadConfig();
  if (!config.sync) {
    stdout.write('sync not configured. Run: shinobi sync init <repo-path> [branch]\n');
    return;
  }

  stdout.write(`  repo:         ${config.sync.repo_path}\n`);
  stdout.write(`  branch:       ${config.sync.branch}\n`);
  stdout.write(`  last push:    ${config.sync.last_push_at ?? 'never'}\n`);
  stdout.write(`  last pull:    ${config.sync.last_pull_at ?? 'never'}\n`);

  if (!existsSync(config.sync.repo_path)) {
    stderr.write(`\nrepo path missing!\n`);
    return;
  }
  const statusResult = tryGit(config.sync.repo_path, ['status', '--short']);
  if (!statusResult.ok) {
    stderr.write(`\nnot a git repo: ${statusResult.err}\n`);
    return;
  }
  stdout.write(`\n  git status:\n${statusResult.stdout === '' ? '  (clean)' : statusResult.stdout}\n`);
}
