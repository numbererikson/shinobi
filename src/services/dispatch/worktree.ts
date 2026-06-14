// Git worktree isolation for the swarm: each agent gets its own working copy on
// its own branch, forked from HEAD, so N agents editing files in parallel never
// clobber each other. The shared Shinobi brain (DB) coordinates *which* task each
// agent works; worktrees coordinate *where* their edits land.

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export interface Worktree {
  agentId: string;
  path: string;
  branch: string;
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** True when cwd is inside a git work tree. */
export function isGitRepo(cwd: string): boolean {
  try {
    return git(['rev-parse', '--is-inside-work-tree'], cwd) === 'true';
  } catch {
    return false;
  }
}

/**
 * Create `count` worktrees under baseDir, one per agent, each on its own branch
 * forked from the current HEAD of repoCwd.
 */
export function createWorktrees(
  repoCwd: string,
  baseDir: string,
  count: number,
  label: string,
): Worktree[] {
  const head = git(['rev-parse', 'HEAD'], repoCwd);
  const created: Worktree[] = [];
  for (let i = 0; i < count; i++) {
    const agentId = `agent-${i + 1}`;
    const path = join(baseDir, agentId);
    const branch = `swarm/${label}/${agentId}`;
    git(['worktree', 'add', '-b', branch, path, head], repoCwd);
    created.push({ agentId, path, branch });
  }
  return created;
}

/** Remove one worktree (and optionally delete its branch). Best-effort. */
export function removeWorktree(repoCwd: string, wt: Worktree, deleteBranch = true): void {
  try {
    git(['worktree', 'remove', '--force', wt.path], repoCwd);
  } catch {
    // already gone / dirty — leave it for the operator
  }
  if (deleteBranch) {
    try {
      git(['branch', '-D', wt.branch], repoCwd);
    } catch {
      // branch may carry unmerged work the operator wants — ignore
    }
  }
}

export function removeWorktrees(repoCwd: string, worktrees: Worktree[], deleteBranch = true): void {
  for (const wt of worktrees) removeWorktree(repoCwd, wt, deleteBranch);
}
