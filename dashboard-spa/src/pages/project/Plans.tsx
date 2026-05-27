import { useOutletContext } from 'react-router-dom';
import { timeSince } from '../../lib/format';
import type { ProjectOutletCtx } from '../ProjectLayout';

export function Plans() {
  const { snapshot } = useOutletContext<ProjectOutletCtx>();
  const { latest_plan, plan_history } = snapshot;

  if (!latest_plan) {
    return (
      <div className="bg-panel border border-dashed border-border rounded p-6 text-center text-text-muted">
        No plans saved. Use <code>save_plan</code> to persist an approved plan.
      </div>
    );
  }

  return (
    <div>
      <section className="mb-8">
        <h3 className="text-sm text-text mb-2">Latest plan — v{latest_plan.version}</h3>
        <div className="text-text-muted text-xs mb-3">saved {timeSince(latest_plan.created_at)}</div>
        <pre className="bg-panel border border-border rounded p-4 text-xs font-mono text-text whitespace-pre-wrap overflow-x-auto">{latest_plan.plan_md}</pre>
      </section>

      {plan_history.length > 0 && (
        <section>
          <h3 className="text-sm text-text mb-3">Version history</h3>
          <ul className="space-y-1 text-sm">
            {plan_history.map((h) => (
              <li key={h.id} className="text-text-muted">
                <span className="text-text font-medium">v{h.version}</span> — {h.created_at} ({h.plan_md_length} chars)
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
