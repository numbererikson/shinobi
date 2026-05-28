import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { FolderKanban, ListTodo, Lightbulb, AlertTriangle, FileText, Search } from 'lucide-react';
import { recall, type RecallResult } from '../lib/api';

type Kind = 'project' | 'subtask' | 'decision' | 'dead_end' | 'note';

interface FlatHit {
  kind: Kind;
  id: number;
  title: string;
  subtitle: string;
  projectId: number | null;
  href: string;
}

const KIND_META: Record<Kind, { label: string; icon: typeof FolderKanban }> = {
  project: { label: 'Projects', icon: FolderKanban },
  subtask: { label: 'Tasks', icon: ListTodo },
  decision: { label: 'Decisions', icon: Lightbulb },
  dead_end: { label: 'Dead ends', icon: AlertTriangle },
  note: { label: 'Notes', icon: FileText },
};

function flatten(r: RecallResult): FlatHit[] {
  const out: FlatHit[] = [];
  for (const p of r.projects) {
    out.push({
      kind: 'project',
      id: p.id,
      title: p.title,
      subtitle: p.workspace ? `workspace: ${p.workspace}` : 'no workspace',
      projectId: p.id,
      href: `/projects/${p.id}`,
    });
  }
  for (const s of r.subtasks) {
    out.push({
      kind: 'subtask',
      id: s.id,
      title: s.title,
      subtitle: `task #${s.id} · status: ${s.status}`,
      projectId: s.project_id,
      href: `/projects/${s.project_id}`,
    });
  }
  for (const d of r.decisions) {
    out.push({
      kind: 'decision',
      id: d.id,
      title: d.summary,
      subtitle: `decision #${d.id} · ${d.kind}`,
      projectId: d.project_id,
      href: `/projects/${d.project_id}/decisions`,
    });
  }
  for (const de of r.dead_ends) {
    out.push({
      kind: 'dead_end',
      id: de.id,
      title: de.attempted_approach.slice(0, 100),
      subtitle: `dead end #${de.id}${de.never_retry ? ' · never retry' : ''}`,
      projectId: de.project_id,
      href: `/projects/${de.project_id}/dead-ends`,
    });
  }
  for (const n of r.notes) {
    out.push({
      kind: 'note',
      id: n.id,
      title: n.body.slice(0, 100),
      subtitle: `note #${n.id}`,
      projectId: n.project_id,
      href: `/projects/${n.project_id}/notes`,
    });
  }
  return out;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<RecallResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResult(null);
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResult(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(() => {
      recall(trimmed, 6)
        .then((r) => {
          setResult(r);
          setSelected(0);
        })
        .catch(() => setResult(null))
        .finally(() => setLoading(false));
    }, 150);
    return () => clearTimeout(handle);
  }, [query, open]);

  const hits = useMemo(() => (result ? flatten(result) : []), [result]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, hits.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === 'Enter') {
        const hit = hits[selected];
        if (hit) {
          e.preventDefault();
          navigate(hit.href);
          onClose();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, hits, selected, navigate, onClose]);

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-cmd-idx="${selected}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!open) return null;

  const grouped = (['project', 'subtask', 'decision', 'dead_end', 'note'] as Kind[])
    .map((k) => ({ kind: k, items: hits.filter((h) => h.kind === k) }))
    .filter((g) => g.items.length > 0);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-20 px-4"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" aria-hidden />
      <div
        className="relative w-full max-w-2xl bg-panel border border-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="w-4 h-4 text-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects, tasks, decisions, dead ends, notes..."
            className="flex-1 bg-transparent text-text placeholder:text-text-dim outline-none text-sm"
          />
          <kbd className="text-[10px] text-text-dim border border-border rounded px-1.5 py-0.5">esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto">
          {query.trim().length < 2 ? (
            <div className="px-4 py-6 text-center text-text-dim text-sm">
              Type at least 2 characters to search.
            </div>
          ) : loading && hits.length === 0 ? (
            <div className="px-4 py-6 text-center text-text-muted text-sm">Searching...</div>
          ) : hits.length === 0 ? (
            <div className="px-4 py-6 text-center text-text-muted text-sm">
              No matches for "{query}".
            </div>
          ) : (
            grouped.map((g) => {
              const meta = KIND_META[g.kind];
              const Icon = meta.icon;
              return (
                <div key={g.kind} className="py-1">
                  <div className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-text-dim flex items-center gap-1.5">
                    <Icon className="w-3 h-3" />
                    {meta.label}
                    <span className="text-text-dim">· {g.items.length}</span>
                  </div>
                  {g.items.map((hit) => {
                    const idx = hits.indexOf(hit);
                    const isSelected = idx === selected;
                    return (
                      <button
                        key={`${hit.kind}-${hit.id}`}
                        data-cmd-idx={idx}
                        onMouseEnter={() => setSelected(idx)}
                        onClick={() => {
                          navigate(hit.href);
                          onClose();
                        }}
                        className={`w-full text-left px-4 py-2 flex flex-col gap-0.5 border-l-2 ${
                          isSelected
                            ? 'bg-panel-2 border-accent'
                            : 'border-transparent hover:bg-panel-2/60'
                        }`}
                      >
                        <span className="text-sm text-text truncate">{hit.title}</span>
                        <span className="text-[11px] text-text-muted truncate">{hit.subtitle}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="px-4 py-2 border-t border-border text-[10px] text-text-dim flex items-center justify-between">
          <span className="flex items-center gap-3">
            <span><kbd className="border border-border rounded px-1 py-0.5">↑</kbd> <kbd className="border border-border rounded px-1 py-0.5">↓</kbd> navigate</span>
            <span><kbd className="border border-border rounded px-1 py-0.5">↵</kbd> open</span>
            <span><kbd className="border border-border rounded px-1 py-0.5">esc</kbd> close</span>
          </span>
          {result && <span>{hits.length} {hits.length === 1 ? 'result' : 'results'}</span>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
