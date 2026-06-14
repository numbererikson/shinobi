import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createWorktrees, isGitRepo, removeWorktrees } from './worktree.js';

let repo: string;
let nonRepo: string;

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'shinobi-wt-repo-'));
  nonRepo = mkdtempSync(join(tmpdir(), 'shinobi-wt-plain-'));
  git(['init', '-b', 'main'], repo);
  git(['config', 'user.email', 'wt@example.com'], repo);
  git(['config', 'user.name', 'Worktree Test'], repo);
  writeFileSync(join(repo, 'README.md'), '# seed\n');
  git(['add', '-A'], repo);
  git(['commit', '-m', 'seed'], repo);
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(nonRepo, { recursive: true, force: true });
});

describe('isGitRepo', () => {
  it('detects a git work tree', () => {
    expect(isGitRepo(repo)).toBe(true);
  });
  it('returns false for a plain directory', () => {
    expect(isGitRepo(nonRepo)).toBe(false);
  });
});

describe('createWorktrees / removeWorktrees', () => {
  it('creates one isolated worktree + branch per agent, then removes them', () => {
    const base = join(repo, '.wt');
    const worktrees = createWorktrees(repo, base, 3, 'lbl');

    expect(worktrees).toHaveLength(3);
    for (const wt of worktrees) {
      expect(existsSync(wt.path)).toBe(true);
      expect(existsSync(join(wt.path, 'README.md'))).toBe(true);
      expect(wt.branch).toBe(`swarm/lbl/${wt.agentId}`);
    }
    // distinct paths + branches
    expect(new Set(worktrees.map((w) => w.path)).size).toBe(3);
    expect(new Set(worktrees.map((w) => w.branch)).size).toBe(3);

    removeWorktrees(repo, worktrees, true);
    for (const wt of worktrees) {
      expect(existsSync(wt.path)).toBe(false);
    }
  });
});
