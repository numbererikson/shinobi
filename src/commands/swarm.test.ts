import { describe, expect, it } from 'vitest';

import { buildDispatchArgs } from './swarm.js';

describe('buildDispatchArgs', () => {
  it('is empty for a bare continuous swarm', () => {
    expect(buildDispatchArgs({ agents: 2 })).toEqual([]);
  });

  it('forwards once / project / interval (seconds) / max-failures to each agent', () => {
    const args = buildDispatchArgs({
      agents: 3,
      once: true,
      projectId: 58,
      intervalMs: 45_000,
      maxFailures: 4,
    });
    expect(args).toEqual([
      '--once',
      '--project', '58',
      '--interval', '45',
      '--max-failures', '4',
    ]);
  });

  it('does not leak swarm-only options (worktree flags, agent count) to the child', () => {
    const args = buildDispatchArgs({
      agents: 5,
      useWorktrees: false,
      keepWorktrees: true,
      worktreeBase: '/tmp/x',
    });
    expect(args).toEqual([]);
  });
});
