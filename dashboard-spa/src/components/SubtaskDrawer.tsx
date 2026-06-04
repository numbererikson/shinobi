import { Check, Play, Undo2, X } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from './ui/Button';
import { PriorityBadge, StatusBadge } from './ui/Badge';
import { timeSince } from '../lib/format';
import { patchSubtask } from '../lib/api';
import type { Status, Subtask } from '../lib/types';

interface SubtaskDrawerProps {
  subtask: Subtask | null;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}

export function SubtaskDrawer({ subtask, onClose, onChanged }: SubtaskDrawerProps) {
  useEffect(() => {
    if (!subtask) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [subtask, onClose]);

  if (!subtask) return null;

  async function transition(status: Status) {
    if (!subtask) return;
    try {
      await patchSubtask(subtask.id, { status });
      await onChanged();
    } catch (e) {
      alert('Transition failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] bg-bg border-l border-border shadow-2xl flex flex-col"
        role="dialog"
        aria-label={`Subtask ${subtask.id}`}
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-text-muted mb-1">
              #{subtask.id}
            </div>
            <h2 className="text-lg font-semibold text-text break-words">{subtask.title}</h2>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <StatusBadge status={subtask.status} />
              <PriorityBadge priority={subtask.priority} />
              {subtask.due_date && (
                <span className="text-xs text-text-muted">due {subtask.due_date}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {subtask.description ? (
            <section>
              <div className="text-[11px] uppercase tracking-wider text-text-muted mb-2">
                Description
              </div>
              <div className="text-sm text-text whitespace-pre-wrap leading-relaxed">
                {subtask.description}
              </div>
            </section>
          ) : (
            <section className="text-sm text-text-dim italic">No description.</section>
          )}

          <section>
            <div className="text-[11px] uppercase tracking-wider text-text-muted mb-2">
              Transition status
            </div>
            <div className="flex gap-2 flex-wrap">
              {subtask.status !== 'todo' && (
                <Button size="sm" variant="ghost" onClick={() => void transition('todo')} className="flex items-center gap-1">
                  <Undo2 className="w-3 h-3" /> todo
                </Button>
              )}
              {subtask.status !== 'in_progress' && (
                <Button size="sm" variant="ghost" onClick={() => void transition('in_progress')} className="flex items-center gap-1">
                  <Play className="w-3 h-3" /> in progress
                </Button>
              )}
              {subtask.status !== 'done' && (
                <Button size="sm" variant="ghost" onClick={() => void transition('done')} className="flex items-center gap-1">
                  <Check className="w-3 h-3" /> done
                </Button>
              )}
            </div>
          </section>

          {subtask.depends_on && subtask.depends_on.length > 0 && (
            <section>
              <div className="text-[11px] uppercase tracking-wider text-text-muted mb-2">
                Depends on
              </div>
              <div className="text-sm text-text font-mono">
                {subtask.depends_on.join(', ')}
              </div>
            </section>
          )}

          {subtask.files_touched && subtask.files_touched.length > 0 && (
            <section>
              <div className="text-[11px] uppercase tracking-wider text-text-muted mb-2">
                Files touched
              </div>
              <ul className="text-xs text-text font-mono space-y-1">
                {subtask.files_touched.map((f) => (
                  <li key={f} className="break-all">{f}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div className="text-text-muted">Created</div>
            <div className="text-text" title={subtask.created_at}>{timeSince(subtask.created_at)}</div>
            <div className="text-text-muted">Updated</div>
            <div className="text-text" title={subtask.updated_at}>{timeSince(subtask.updated_at)}</div>
            {subtask.last_claimed_at && (
              <>
                <div className="text-text-muted">Last claimed</div>
                <div className="text-text" title={subtask.last_claimed_at}>{timeSince(subtask.last_claimed_at)}</div>
              </>
            )}
            {subtask.claude_session_id && (
              <>
                <div className="text-text-muted">Session</div>
                <div className="text-text font-mono break-all">{subtask.claude_session_id}</div>
              </>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}
