#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { argv, env, exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { readEnvFile } from './dashboard/settings-store.js';

// Hydrate process.env from ~/.shinobi/.env so that settings written via the
// dashboard Settings UI (or `shinobi sync init`) are visible to code paths
// that read process.env directly (dashboard host/port/auth, relay client,
// embedding factory, etc). Existing env vars win — caller-supplied env is
// always authoritative.
try {
  const parsed = readEnvFile();
  for (const [k, v] of Object.entries(parsed.values)) {
    if (env[k] === undefined) env[k] = v;
  }
} catch {
  // .env missing or unreadable on a fresh install — nothing to hydrate.
}

import { printInitSummary, printMcpConfig, runInit } from './commands/init.js';
import { costIngest } from './commands/cost.js';
import { runDigest } from './commands/digest.js';
import { syncInit, syncPull, syncPush, syncStatus } from './commands/sync.js';
import { startDashboard } from './dashboard/server.js';
import { applyPendingMigrations } from './lib/migrations.js';
import { startMcpServer } from './server/mcp.js';

const COMMANDS = ['init', 'mcp', 'dashboard', 'migrate', 'sync', 'cost', 'digest'] as const;
type Command = (typeof COMMANDS)[number];

function readVersion(): string {
  try {
    const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function printUsage(): void {
  stdout.write(`shinobi — local-first task spine + memory layer for AI coding agents

Usage:
  shinobi <command> [options]

Commands:
  init                            Bootstrap ~/.shinobi/ and write MCP config (.mcp.json + .cursor/mcp.json)
  init --print-config             Print the MCP server JSON snippet to stdout (for Cline / Continue / Zed)
  mcp                             Run the MCP server over stdio (invoked by the MCP client)
  migrate                         Apply pending SQL migrations
  sync init <path> [branch]       Configure a local git repo as the cross-machine sync target
  sync push                       Snapshot the DB and commit it to the sync repo
  sync pull                       Restore the DB from the sync repo's snapshot
  sync status                     Show last push/pull timestamps and git status
  dashboard                       Start the web dashboard on localhost (default port 8765)
  cost ingest [--since H]         Parse Claude Code transcripts under ~/.claude/projects/ and upsert per-session AI token cost (USD)
  cost ingest --source <dir>      Override transcript root (e.g. another machine's mirrored directory)
  digest [--workspace W] [--telegram]   Render weekly Markdown summary → ~/.shinobi/digests/YYYY-WW.md
  digest --since YYYY-MM-DD --until YYYY-MM-DD   Custom window (otherwise last 7 days)

Options:
  --version, -v                   Print the installed shinobi version and exit
  --help, -h                      Print this help and exit
  --force                         For \`init\`, overwrite an existing .mcp.json or .env
`);
}

async function runMigrate(): Promise<void> {
  const result = applyPendingMigrations();
  stdout.write(
    `applied=${result.applied.length} skipped=${result.skipped.length} mismatched=${result.mismatched.length}\n`,
  );
  if (result.applied.length > 0) {
    stdout.write(`  applied: ${result.applied.join(', ')}\n`);
  }
  if (result.mismatched.length > 0) {
    stderr.write(`CHECKSUM MISMATCH: ${result.mismatched.join(', ')}\n`);
    exit(2);
  }
}

async function dispatchInit(rest: string[]): Promise<void> {
  if (rest.includes('--print-config')) {
    printMcpConfig();
    return;
  }
  const force = rest.includes('--force');
  const result = runInit({ force });
  printInitSummary(result);
}

async function dispatchCost(rest: string[]): Promise<void> {
  const sub = rest[0];
  if (sub !== 'ingest') {
    stderr.write(`cost: unknown subcommand "${sub ?? ''}". Use: ingest [--since H] [--source DIR]\n`);
    exit(1);
    return;
  }
  const options: Parameters<typeof costIngest>[0] = {};
  for (let i = 1; i < rest.length; i++) {
    const v = rest[i];
    if (v === '--since' && rest[i + 1]) {
      options.sinceHours = Number(rest[++i]);
    } else if (v === '--source' && rest[i + 1]) {
      options.source = rest[++i];
    } else if (v === '--project' && rest[i + 1]) {
      options.projectFilter = rest[++i];
    } else if (v === '--quiet') {
      options.quiet = true;
    } else {
      stderr.write(`cost ingest: unknown option "${v}"\n`);
      exit(1);
      return;
    }
  }
  applyPendingMigrations();
  costIngest(options);
}

async function dispatchDigest(rest: string[]): Promise<void> {
  const options: Parameters<typeof runDigest>[0] = {};
  for (let i = 0; i < rest.length; i++) {
    const v = rest[i];
    if (v === '--workspace' && rest[i + 1]) options.workspace = rest[++i];
    else if (v === '--since' && rest[i + 1]) options.sinceIso = rest[++i];
    else if (v === '--until' && rest[i + 1]) options.untilIso = rest[++i];
    else if (v === '--out' && rest[i + 1]) options.out = rest[++i];
    else if (v === '--telegram') options.telegram = true;
    else if (v === '--no-write') options.noWrite = true;
    else if (v === '--quiet') options.quiet = true;
    else {
      stderr.write(`digest: unknown option "${v}"\n`);
      exit(1);
      return;
    }
  }
  applyPendingMigrations();
  await runDigest(options);
}

async function dispatchSync(rest: string[]): Promise<void> {
  const sub = rest[0];
  if (!sub) {
    stderr.write('sync: missing subcommand. Use: init | push | pull | status\n');
    exit(1);
    return;
  }
  switch (sub) {
    case 'init': {
      const repoPath = rest[1];
      if (!repoPath) {
        stderr.write('sync init: missing <repo-path>\n');
        exit(1);
        return;
      }
      syncInit(repoPath, rest[2]);
      return;
    }
    case 'push':
      await syncPush();
      return;
    case 'pull':
      syncPull();
      return;
    case 'status':
      syncStatus();
      return;
    default:
      stderr.write(`sync: unknown subcommand "${sub}"\n`);
      exit(1);
  }
}

async function main(): Promise<void> {
  const [, , rawCommand, ...rest] = argv;

  if (!rawCommand || rawCommand === '--help' || rawCommand === '-h') {
    printUsage();
    return;
  }

  if (rawCommand === '--version' || rawCommand === '-v') {
    stdout.write(`shinobi ${readVersion()}\n`);
    return;
  }

  if (!COMMANDS.includes(rawCommand as Command)) {
    stderr.write(`shinobi: unknown command "${rawCommand}"\n\n`);
    printUsage();
    exit(1);
  }

  const command = rawCommand as Command;

  switch (command) {
    case 'init':
      await dispatchInit(rest);
      return;
    case 'mcp':
      await startMcpServer();
      return;
    case 'migrate':
      await runMigrate();
      return;
    case 'sync':
      await dispatchSync(rest);
      return;
    case 'dashboard':
      applyPendingMigrations();
      await startDashboard();
      return;
    case 'cost':
      await dispatchCost(rest);
      return;
    case 'digest':
      await dispatchDigest(rest);
      return;
  }
}

main().catch((err: unknown) => {
  stderr.write(`shinobi: fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  exit(1);
});
