import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { ProjectOutletCtx } from '../ProjectLayout';
import { costIngest, getProjectCostStats, getProjectTimeStats, type ProjectCostStats, type ProjectTimeStats } from '../../lib/api';

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-panel border border-border rounded p-3">
      <div className="text-[11px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className="text-2xl text-text mt-1">{value}</div>
    </div>
  );
}

export function Analytics() {
  const { snapshot } = useOutletContext<ProjectOutletCtx>();
  const { subtasks, decisions, dead_ends, notes, sessions, activity, plan_history, draft_counts, project } = snapshot;

  const [timeStats, setTimeStats] = useState<ProjectTimeStats | null>(null);
  const [costStats, setCostStats] = useState<ProjectCostStats | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [ingestMsg, setIngestMsg] = useState<string | null>(null);

  const refreshStats = (): void => {
    void getProjectTimeStats(project.id).then(setTimeStats);
    void getProjectCostStats(project.id).then(setCostStats);
  };

  useEffect(() => {
    let cancelled = false;
    void getProjectTimeStats(project.id).then((s) => { if (!cancelled) setTimeStats(s); });
    void getProjectCostStats(project.id).then((s) => { if (!cancelled) setCostStats(s); });
    return () => { cancelled = true; };
  }, [project.id]);

  const runIngest = async (): Promise<void> => {
    setIngesting(true);
    setIngestMsg(null);
    try {
      const r = await costIngest({ since_hours: 24 * 30 });
      setIngestMsg(`parsed ${r.parsed} transcripts, upserted ${r.upserted}, total scanned ≈ $${r.total_cost_usd.toFixed(2)}`);
      refreshStats();
    } catch (e) {
      setIngestMsg('ingest failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIngesting(false);
    }
  };

  const subtaskTitleById = new Map(subtasks.map((s) => [s.id, s.title]));

  const subCounts = {
    total: subtasks.length,
    todo: subtasks.filter((s) => s.status === 'todo').length,
    in_progress: subtasks.filter((s) => s.status === 'in_progress').length,
    done: subtasks.filter((s) => s.status === 'done').length,
  };
  const decCounts = {
    total: decisions.length,
    open: decisions.filter((d) => d.status === 'open').length,
    fixed: decisions.filter((d) => d.status === 'fixed').length,
  };
  const now = Date.now();
  const activityLast24h = activity.filter((a) => {
    const t = new Date(a.created_at.replace(' ', 'T') + 'Z').getTime();
    return !isNaN(t) && now - t < 86_400_000;
  }).length;

  const actionCounts = new Map<string, number>();
  for (const a of activity) actionCounts.set(a.action_type, (actionCounts.get(a.action_type) ?? 0) + 1);
  const recentActions = [...actionCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);

  return (
    <div>
      <section className="mb-6">
        <h3 className="text-sm text-text mb-3">Subtasks</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="total" value={subCounts.total} />
          <Stat label="todo" value={subCounts.todo} />
          <Stat label="in progress" value={subCounts.in_progress} />
          <Stat label="done" value={subCounts.done} />
        </div>
      </section>

      <section className="mb-6">
        <h3 className="text-sm text-text mb-3">Memory</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="decisions" value={decCounts.total} />
          <Stat label="decisions open" value={decCounts.open} />
          <Stat label="decisions fixed" value={decCounts.fixed} />
          <Stat label="drafts pending" value={draft_counts.pending} />
          <Stat label="drafts approved" value={draft_counts.approved} />
          <Stat label="dead ends" value={dead_ends.length} />
          <Stat label="notes" value={notes.length} />
          <Stat label="plan versions" value={plan_history.length} />
        </div>
      </section>

      <section className="mb-6">
        <h3 className="text-sm text-text mb-3">Time on task</h3>
        {timeStats === null ? (
          <div className="text-text-muted text-sm">loading…</div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
              <div className="bg-panel border border-border rounded p-3">
                <div className="text-[11px] uppercase tracking-wider text-text-muted">total time</div>
                <div className="text-2xl text-text mt-1">{fmtDuration(timeStats.total_seconds)}</div>
              </div>
              <Stat label="sessions w/ subtask" value={timeStats.session_count} />
              <Stat label="tasks tracked" value={timeStats.per_subtask.length} />
            </div>
            {timeStats.per_subtask.length === 0 ? (
              <div className="text-text-muted text-sm">(no time-tracked sessions — sessions only count toward a task when claude_session_id is linked at claim)</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-text-muted text-left">
                    <th className="pb-2 pr-3">Task</th>
                    <th className="pb-2 pr-3 text-right">Duration</th>
                    <th className="pb-2 pr-3 text-right">Sessions</th>
                    <th className="pb-2 text-right">Last touched</th>
                  </tr>
                </thead>
                <tbody>
                  {timeStats.per_subtask.slice(0, 20).map((row) => (
                    <tr key={row.subtask_id} className="border-b border-border/40">
                      <td className="py-1.5 pr-3 text-text">
                        <a href={`#subtask-${row.subtask_id}`} className="hover:underline">
                          #{row.subtask_id} {subtaskTitleById.get(row.subtask_id) ?? '(deleted)'}
                        </a>
                      </td>
                      <td className="py-1.5 pr-3 text-text text-right font-mono">{fmtDuration(row.total_seconds)}</td>
                      <td className="py-1.5 pr-3 text-text text-right">{row.session_count}{row.open_sessions > 0 ? <span className="text-warning"> ({row.open_sessions} open)</span> : null}</td>
                      <td className="py-1.5 text-text-muted text-right text-xs">{row.last_session_at ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>

      <section className="mb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-sm text-text">AI token cost</h3>
          <button
            onClick={() => void runIngest()}
            disabled={ingesting}
            className="text-[11px] uppercase tracking-wider text-accent hover:underline disabled:text-text-dim"
          >
            {ingesting ? 'ingesting…' : 'ingest transcripts'}
          </button>
        </div>
        {ingestMsg && <div className="text-text-muted text-xs mb-3">{ingestMsg}</div>}
        {costStats === null ? (
          <div className="text-text-muted text-sm">loading…</div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
              <div className="bg-panel border border-border rounded p-3">
                <div className="text-[11px] uppercase tracking-wider text-text-muted">total cost</div>
                <div className="text-2xl text-text mt-1">${costStats.total_cost_usd.toFixed(2)}</div>
              </div>
              <Stat label="costed sessions" value={costStats.session_count} />
              <Stat label="tasks with cost" value={costStats.per_subtask.length} />
            </div>
            {costStats.per_subtask.length === 0 ? (
              <div className="text-text-muted text-sm">(no cost data yet — click <em>ingest transcripts</em> above to parse <code>~/.claude/projects/</code> JSONL files)</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-text-muted text-left">
                    <th className="pb-2 pr-3">Task</th>
                    <th className="pb-2 pr-3 text-right">Cost (USD)</th>
                    <th className="pb-2 pr-3 text-right">Input tok</th>
                    <th className="pb-2 pr-3 text-right">Output tok</th>
                    <th className="pb-2 text-right">Models</th>
                  </tr>
                </thead>
                <tbody>
                  {costStats.per_subtask.slice(0, 20).map((row) => (
                    <tr key={row.subtask_id} className="border-b border-border/40">
                      <td className="py-1.5 pr-3 text-text">
                        #{row.subtask_id} {subtaskTitleById.get(row.subtask_id) ?? '(deleted)'}
                      </td>
                      <td className="py-1.5 pr-3 text-text text-right font-mono">${row.total_cost_usd.toFixed(4)}</td>
                      <td className="py-1.5 pr-3 text-text-muted text-right font-mono text-xs">{row.total_input_tokens.toLocaleString()}</td>
                      <td className="py-1.5 pr-3 text-text-muted text-right font-mono text-xs">{row.total_output_tokens.toLocaleString()}</td>
                      <td className="py-1.5 text-text-muted text-right text-xs">{row.by_model.map((m) => m.model.replace('claude-', '')).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>

      <section className="mb-6">
        <h3 className="text-sm text-text mb-3">Activity</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <Stat label="sessions" value={sessions.length} />
          <Stat label="events total" value={activity.length} />
          <Stat label="events 24h" value={activityLast24h} />
        </div>
        <h3 className="text-sm text-text mb-3">Recent action counts</h3>
        {recentActions.length === 0 ? (
          <div className="text-text-muted text-sm">(no activity)</div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] uppercase tracking-wider text-text-muted text-left"><th className="pb-2 pr-3">Action</th><th className="pb-2">Count</th></tr></thead>
            <tbody>
              {recentActions.map(([action, count]) => (
                <tr key={action} className="border-b border-border/40">
                  <td className="py-1.5 pr-3 text-text font-mono text-xs">{action}</td>
                  <td className="py-1.5 text-text">{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
