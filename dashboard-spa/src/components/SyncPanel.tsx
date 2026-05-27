import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Loader2 } from 'lucide-react';
import { Button } from './ui/Button';
import { getSyncStatus, syncPull, syncPush } from '../lib/api';
import { timeSince } from '../lib/format';
import type { SyncStatusResponse } from '../lib/types';

type Pending = { kind: 'idle' } | { kind: 'busy'; op: 'push' | 'pull' } | { kind: 'ok'; op: 'push' | 'pull'; elapsedMs: number } | { kind: 'err'; message: string };

export function SyncPanel() {
  const [status, setStatus] = useState<SyncStatusResponse | null>(null);
  const [pending, setPending] = useState<Pending>({ kind: 'idle' });

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      setStatus(await getSyncStatus());
    } catch (err) {
      setPending({ kind: 'err', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function run(op: 'push' | 'pull') {
    if (op === 'pull' && !window.confirm('Pull overwrites the local DB with the latest snapshot from the sync repo. Continue?')) return;
    setPending({ kind: 'busy', op });
    try {
      const res = op === 'push' ? await syncPush() : await syncPull();
      if (!res.ok) throw new Error(res.error ?? 'unknown error');
      setPending({ kind: 'ok', op, elapsedMs: res.elapsed_ms ?? 0 });
      await refresh();
      if (op === 'pull') {
        setTimeout(() => location.reload(), 500);
      }
    } catch (err) {
      setPending({ kind: 'err', message: err instanceof Error ? err.message : String(err) });
    }
  }

  const sync = status?.sync;

  return (
    <div className="bg-panel border border-border rounded-md p-3 mt-4">
      <div className="text-[11px] uppercase tracking-wider text-text-muted mb-2">Sync</div>
      <div className="space-y-1 text-xs font-mono">
        {status?.configured && sync ? (
          <>
            <div>push: <span className={sync.last_push_at ? 'text-success' : 'text-text-muted'}>{timeSince(sync.last_push_at) || 'never'}</span></div>
            <div>pull: <span className={sync.last_pull_at ? 'text-success' : 'text-text-muted'}>{timeSince(sync.last_pull_at) || 'never'}</span></div>
            <div className="text-text-dim text-[10px] break-all">{sync.repo_path}<br/>(branch: {sync.branch})</div>
          </>
        ) : (
          <div className="text-text-muted">not configured</div>
        )}
        {pending.kind === 'ok' && (
          <div className="text-success">{pending.op} OK ({pending.elapsedMs}ms)</div>
        )}
        {pending.kind === 'err' && (
          <div className="text-danger break-all">{pending.message}</div>
        )}
      </div>
      <div className="flex gap-1.5 mt-3">
        <Button
          size="sm"
          variant="default"
          className="flex-1 flex items-center justify-center gap-1"
          disabled={pending.kind === 'busy'}
          onClick={() => void run('pull')}
        >
          {pending.kind === 'busy' && pending.op === 'pull' ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowDownToLine className="w-3 h-3" />}
          Pull
        </Button>
        <Button
          size="sm"
          variant="primary"
          className="flex-1 flex items-center justify-center gap-1"
          disabled={pending.kind === 'busy'}
          onClick={() => void run('push')}
        >
          {pending.kind === 'busy' && pending.op === 'push' ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowUpFromLine className="w-3 h-3" />}
          Push
        </Button>
      </div>
    </div>
  );
}
