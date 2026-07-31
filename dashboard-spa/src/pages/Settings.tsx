import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RotateCw } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { getSettings, patchSettings, type RedactedSetting, type SettingSpec } from '../lib/api';

type DraftValue = string | null;

const GROUP_LABEL: Record<SettingSpec['group'], string> = {
  storage: 'Storage',
  dashboard: 'Dashboard',
  embedding: 'Embedding (semantic recall)',
  llm: 'LLM (extraction + summarization)',
  recall: 'Recall mode',
  sync: 'Sync',
  companion: 'Companion',
};

interface Toast {
  kind: 'ok' | 'err' | 'busy';
  text: string;
}

export function Settings() {
  const [specs, setSpecs] = useState<SettingSpec[] | null>(null);
  const [values, setValues] = useState<RedactedSetting[]>([]);
  const [draft, setDraft] = useState<Record<string, DraftValue>>({});
  const [toast, setToast] = useState<Toast | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getSettings();
      setSpecs(data.specs);
      setValues(data.values);
      setDraft({});
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!specs) return <div className="text-text-muted">loading settings...</div>;

  const valueByKey = new Map(values.map((v) => [v.key, v]));
  const groups = new Map<SettingSpec['group'], SettingSpec[]>();
  for (const spec of specs) {
    if (!groups.has(spec.group)) groups.set(spec.group, []);
    groups.get(spec.group)!.push(spec);
  }

  function setDraftValue(key: string, value: DraftValue) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function clearDraft(key: string) {
    setDraft((d) => {
      const { [key]: _, ...rest } = d;
      void _;
      return rest;
    });
  }

  async function save() {
    if (Object.keys(draft).length === 0) {
      setToast({ kind: 'err', text: 'no changes to save' });
      return;
    }
    setToast({ kind: 'busy', text: 'writing ~/.shinobi/.env ...' });
    try {
      const result = await patchSettings(draft);
      if (!result.ok) throw new Error(result.error ?? 'unknown error');
      const restartHints = Object.keys(draft).filter((k) => specs?.find((s) => s.key === k)?.requiresRestart);
      const msg = `wrote ${result.written ?? 0}, cleared ${result.cleared ?? 0}${restartHints.length > 0 ? ` (restart required: ${restartHints.join(', ')})` : ''}`;
      setToast({ kind: 'ok', text: msg });
      await load();
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="max-w-3xl">
      <header className="border-b border-border pb-3 mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl text-text">Settings</h1>
        <span className="text-text-muted text-xs">writes to ~/.shinobi/.env with backup</span>
      </header>

      {toast && (
        <div
          className={`mb-4 px-4 py-2 rounded text-sm flex items-center gap-2 ${
            toast.kind === 'ok'
              ? 'bg-success/20 text-success border border-success/40'
              : toast.kind === 'err'
                ? 'bg-danger/20 text-danger border border-danger/40'
                : 'bg-warning/20 text-warning border border-warning/40'
          }`}
        >
          {toast.kind === 'ok' && <CheckCircle2 className="w-4 h-4" />}
          {toast.kind === 'err' && <AlertCircle className="w-4 h-4" />}
          {toast.kind === 'busy' && <Loader2 className="w-4 h-4 animate-spin" />}
          {toast.text}
        </div>
      )}

      {[...groups.entries()].map(([group, entries]) => (
        <section key={group} className="mb-8">
          <h2 className="text-sm text-text mb-3 uppercase tracking-wider text-text-muted">
            {GROUP_LABEL[group]}
          </h2>
          <div className="space-y-3">
            {entries.map((spec) => {
              const current = valueByKey.get(spec.key);
              const isDirty = spec.key in draft;
              const draftVal = draft[spec.key];
              return (
                <div key={spec.key} className="bg-panel border border-border rounded p-3">
                  <div className="flex items-baseline justify-between gap-3 mb-1">
                    <div>
                      <label className="text-sm text-text font-medium">
                        {spec.label}
                        {spec.requiresRestart && (
                          <span className="ml-2 text-[10px] uppercase tracking-wider text-warning">
                            restart required
                          </span>
                        )}
                      </label>
                      <code className="ml-2 text-[11px] text-text-muted font-mono">{spec.key}</code>
                    </div>
                    {current?.is_set && !isDirty && (
                      <span className="text-[10px] uppercase tracking-wider text-success">set</span>
                    )}
                    {isDirty && (
                      <span className="text-[10px] uppercase tracking-wider text-warning">unsaved</span>
                    )}
                  </div>
                  <p className="text-xs text-text-muted mb-2">{spec.description}</p>
                  <div className="flex gap-2 items-center">
                    {spec.enumValues ? (
                      <select
                        value={isDirty ? (draftVal ?? '') : (current?.value ?? '')}
                        onChange={(e) => setDraftValue(spec.key, e.target.value || null)}
                        className="bg-panel-2 border border-border rounded px-2 py-1 text-sm text-text font-mono flex-1"
                      >
                        <option value="">(unset)</option>
                        {spec.enumValues.map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={spec.secret ? 'password' : 'text'}
                        value={isDirty ? (draftVal ?? '') : (current?.value ?? '')}
                        placeholder={current?.is_set && spec.secret ? '(secret set — type to replace)' : spec.placeholder ?? '(unset)'}
                        onChange={(e) => setDraftValue(spec.key, e.target.value || null)}
                        className="bg-panel-2 border border-border rounded px-2 py-1 text-sm text-text font-mono flex-1 placeholder:text-text-dim"
                      />
                    )}
                    {isDirty && (
                      <Button size="sm" variant="ghost" onClick={() => clearDraft(spec.key)} title="discard change">
                        <RotateCw className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <div className="sticky bottom-0 bg-bg/95 backdrop-blur border-t border-border py-3 -mx-8 px-8 flex justify-end gap-2">
        <Button variant="default" onClick={() => setDraft({})} disabled={Object.keys(draft).length === 0}>
          Discard all
        </Button>
        <Button variant="primary" onClick={() => void save()} disabled={Object.keys(draft).length === 0}>
          Save ({Object.keys(draft).length} change{Object.keys(draft).length === 1 ? '' : 's'})
        </Button>
      </div>
    </div>
  );
}
