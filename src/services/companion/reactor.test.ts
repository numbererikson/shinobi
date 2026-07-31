import { describe, expect, it } from 'vitest';
import { react } from './reactor.js';
import { emptyState, type ActivityEvent, type CompanionState, type Signals } from './types.js';

let nextId = 1;

function event(action_type: string, overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: nextId++,
    action_type,
    project_id: 1,
    entity_id: 10,
    detail: null,
    title: 'Export module',
    created_at: '2026-07-31T10:00:00.000Z',
    ...overrides,
  };
}

function signals(events: ActivityEvent[], overrides: Partial<Signals> = {}): Signals {
  return {
    now: '2026-07-31T10:00:00.000Z',
    events,
    next_task: { id: 11, title: 'CPE track' },
    pending_approvals: 0,
    hours_since_closeout: 0,
    ...overrides,
  };
}

/** Deterministic "random" so variant choice is stable across runs. */
const firstVariant = () => 0;

describe('react', () => {
  it('says nothing when nothing happened', () => {
    const result = react(signals([]), emptyState(), { random: firstVariant });
    expect(result.reaction).toBeNull();
  });

  it('reports a completion in the business register, with the next task', () => {
    const result = react(signals([event('complete_task')]), emptyState(), { random: firstVariant });
    expect(result.reaction?.register).toBe('business');
    expect(result.reaction?.pose).toBe('talk');
    expect(result.reaction?.line).toContain('Export module');
    expect(result.reaction?.detail).toContain('CPE track');
  });

  it('drops the "next up" half when the queue has nothing ready', () => {
    const result = react(
      signals([event('complete_task')], { next_task: null }),
      emptyState(),
      { random: firstVariant },
    );
    expect(result.reaction?.detail).toBeNull();
  });

  it('unlocks the cheer register only on a real streak', () => {
    const three = [event('complete_task'), event('complete_task'), event('complete_task')];
    const result = react(signals(three), emptyState(), { random: firstVariant });
    expect(result.reaction?.register).toBe('cheer');
    expect(result.reaction?.line).toContain('3');
  });

  it('resets the streak when a task comes back blocked', () => {
    const first = react(
      signals([event('complete_task'), event('complete_task')]),
      emptyState(),
      { random: firstVariant },
    );
    expect(first.state.completed_streak).toBe(2);

    const second = react(signals([event('dispatch_blocked')]), first.state, { random: firstVariant });
    expect(second.state.completed_streak).toBe(0);
  });

  it('lets trouble outrank progress inside one batch', () => {
    const batch = [event('complete_task'), event('complete_task'), event('dispatch_blocked')];
    const result = react(signals(batch), emptyState(), { random: firstVariant });
    expect(result.reaction?.register).toBe('caution');
  });

  it('turns dry on the second block of the same task', () => {
    const first = react(signals([event('dispatch_blocked')]), emptyState(), { random: firstVariant });
    expect(first.reaction?.register).toBe('caution');

    const second = react(signals([event('dispatch_blocked')]), first.state, { random: firstVariant });
    expect(second.reaction?.register).toBe('dry');
    expect(second.reaction?.line).toContain('Export module');
  });

  it('counts blocks per task, not globally', () => {
    const first = react(signals([event('dispatch_blocked', { entity_id: 10 })]), emptyState(), {
      random: firstVariant,
    });
    const other = react(signals([event('dispatch_blocked', { entity_id: 99 })]), first.state, {
      random: firstVariant,
    });
    expect(other.reaction?.register).toBe('caution');
  });

  it('acknowledges a logged dead end', () => {
    const result = react(signals([event('log_dead_end')]), emptyState(), { random: firstVariant });
    expect(result.reaction?.trigger).toBe('dead_end');
    expect(result.reaction?.register).toBe('caution');
  });

  it('only nags about approvals when no work happened', () => {
    const busy = react(
      signals([event('complete_task')], { pending_approvals: 2 }),
      emptyState(),
      { random: firstVariant },
    );
    expect(busy.reaction?.trigger).toBe('task_completed');

    const quiet = react(signals([], { pending_approvals: 2 }), emptyState(), {
      random: firstVariant,
    });
    expect(quiet.reaction?.trigger).toBe('approvals');
    expect(quiet.reaction?.line).toContain('2');
  });

  it('nags about an unclosed session past the threshold', () => {
    const result = react(
      signals([], { hours_since_closeout: 4 }),
      emptyState(),
      { random: firstVariant, staleSessionHours: 3 },
    );
    expect(result.reaction?.trigger).toBe('stale_session');
    expect(result.reaction?.line).toContain('4');
  });

  it('stays quiet about a brain that has never had a session', () => {
    const result = react(signals([], { hours_since_closeout: null }), emptyState(), {
      random: firstVariant,
    });
    expect(result.reaction).toBeNull();
  });

  it('does not repeat the same sentence twice in a row', () => {
    const first = react(signals([event('complete_task')]), emptyState(), { random: firstVariant });
    const second = react(signals([event('complete_task')]), first.state, { random: firstVariant });
    expect(second.reaction?.line).not.toBe(first.reaction?.line);
  });

  it('advances the seen-activity watermark so events are not replayed', () => {
    const e = event('complete_task');
    const result = react(signals([e]), emptyState(), { random: firstVariant });
    expect(result.state.last_activity_id).toBe(e.id);
  });

  it('speaks Croatian when asked', () => {
    const result = react(signals([event('complete_task')]), emptyState(), {
      random: firstVariant,
      locale: 'hr',
    });
    expect(result.reaction?.line).toContain('šefe');
  });

  it('keeps the last reaction on the state for the widget to show', () => {
    const first = react(signals([event('complete_task')]), emptyState(), { random: firstVariant });
    const idle: CompanionState = react(signals([]), first.state, { random: firstVariant }).state;
    expect(idle.last_reaction?.trigger).toBe('task_completed');
  });
});
