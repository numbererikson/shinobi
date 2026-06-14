// `shinobi swarm` — run N dispatch loops in parallel, each in its own git
// worktree, all sharing one brain. The task spine's atomic claim (claimNextTask)
// guarantees two agents never grab the same task; worktrees keep their file
// edits isolated on a branch per agent. The operator's phone is the control
// surface (Kanban + approval gates); the flota drains the backlog.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { argv, cwd as getCwd, exit, execPath, stderr, stdout } from 'node:process';
import {
  createWorktrees,
  isGitRepo,
  removeWorktrees,
  type Worktree,
} from '../services/dispatch/worktree.js';

export interface SwarmOptions {
  agents: number;
  projectId?: number;
  once?: boolean;
  drain?: boolean;
  intervalMs?: number;
  maxFailures?: number;
  /** Default true. When false, all agents share the current directory. */
  useWorktrees?: boolean;
  keepWorktrees?: boolean;
  worktreeBase?: string;
}

function log(msg: string): void {
  stdout.write(`[swarm ${new Date().toISOString()}] ${msg}\n`);
}

/** Translate swarm options into the args each child `shinobi dispatch` receives. */
export function buildDispatchArgs(opts: SwarmOptions): string[] {
  const args: string[] = [];
  if (opts.once) args.push('--once');
  if (opts.drain) args.push('--drain');
  if (opts.projectId !== undefined) args.push('--project', String(opts.projectId));
  if (opts.intervalMs !== undefined) args.push('--interval', String(Math.round(opts.intervalMs / 1000)));
  if (opts.maxFailures !== undefined) args.push('--max-failures', String(opts.maxFailures));
  return args;
}

function pipePrefixed(child: ChildProcess, agentId: string): void {
  const emit = (sink: NodeJS.WritableStream) => (buf: Buffer) => {
    for (const line of buf.toString().split('\n')) {
      if (line.length > 0) sink.write(`  ${agentId} | ${line}\n`);
    }
  };
  child.stdout?.on('data', emit(stdout));
  child.stderr?.on('data', emit(stderr));
}

function waitForExit(child: ChildProcess): Promise<number> {
  return new Promise((res) => child.on('close', (code) => res(code ?? 0)));
}

export async function runSwarm(opts: SwarmOptions): Promise<void> {
  const repoCwd = getCwd();
  const useWorktrees = opts.useWorktrees !== false;
  const label = `${hostname().replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 24)}-${Date.now().toString(36)}`;
  const base = opts.worktreeBase ?? join(repoCwd, '.shinobi-worktrees', label);

  let worktrees: Worktree[] = [];
  if (useWorktrees) {
    if (!isGitRepo(repoCwd)) {
      stderr.write('swarm: not a git repo — pass --no-worktree to run agents in the current directory\n');
      exit(1);
      return;
    }
    mkdirSync(base, { recursive: true });
    worktrees = createWorktrees(repoCwd, base, opts.agents, label);
    log(`created ${worktrees.length} worktree(s) under ${base}`);
  }

  const cliPath = resolve(argv[1] ?? '');
  const dispatchArgs = buildDispatchArgs(opts);
  const children: ChildProcess[] = [];

  for (let i = 0; i < opts.agents; i++) {
    const agentId = `agent-${i + 1}`;
    const agentCwd = useWorktrees ? worktrees[i]!.path : repoCwd;
    const child = spawn(execPath, [cliPath, 'dispatch', ...dispatchArgs], {
      cwd: agentCwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    pipePrefixed(child, agentId);
    children.push(child);
    log(`spawned ${agentId} (pid ${child.pid ?? '?'}) cwd=${agentCwd}`);
  }

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('shutdown signal — stopping agents');
    for (const c of children) c.kill('SIGTERM');
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const mode = opts.once ? ' (once)' : opts.drain ? ' (drain)' : '';
  log(`running ${opts.agents} agent(s)${mode} — shared brain, ${useWorktrees ? 'isolated worktrees' : 'shared cwd'}`);
  await Promise.all(children.map(waitForExit));
  log('all agents exited');

  process.off('SIGINT', shutdown);
  process.off('SIGTERM', shutdown);

  if (useWorktrees) {
    if (opts.keepWorktrees) {
      log(`kept worktrees — branches: ${worktrees.map((w) => w.branch).join(', ')}`);
    } else {
      removeWorktrees(repoCwd, worktrees, true);
      log('removed worktrees + branches');
    }
  }
}
