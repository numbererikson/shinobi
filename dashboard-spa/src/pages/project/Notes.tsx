import { useOutletContext } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { timeSince } from '../../lib/format';
import type { ProjectOutletCtx } from '../ProjectLayout';

export function Notes() {
  const { snapshot } = useOutletContext<ProjectOutletCtx>();
  const { notes } = snapshot;

  if (notes.length === 0) {
    return (
      <div className="bg-panel border border-dashed border-border rounded p-6 text-center text-text-muted">
        No notes yet. Use <code>add_note</code> for stray observations.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {notes.map((n) => (
        <div key={n.id}>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Badge>note #{n.id}</Badge>
            {(n.tags ?? []).map((t) => <Badge key={t}>{t}</Badge>)}
            <span className="text-text-muted text-xs">{timeSince(n.created_at)}</span>
            {n.audio_path && <Badge className="bg-success text-bg">audio</Badge>}
          </div>
          <pre className="bg-panel border border-border rounded p-3 text-xs font-mono text-text whitespace-pre-wrap">{n.body}</pre>
          {n.audio_path && (
            <audio controls className="mt-2 w-full" src={n.audio_path} />
          )}
          {n.files_touched && n.files_touched.length > 0 && (
            <div className="text-text-muted text-xs mt-1">files: {n.files_touched.join(', ')}</div>
          )}
        </div>
      ))}
    </div>
  );
}
