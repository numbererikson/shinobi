import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { AlertCircle, CheckCircle2, ChevronRight, RefreshCw } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PluginIcon } from '../components/PluginIcon';
import { PluginChart } from '../components/PluginChart';
import {
  getPluginPage,
  runPluginPageAction,
  type PluginBlock,
  type PluginButton,
  type PluginFormField,
  type PluginPage as Page,
  type PluginTone,
} from '../lib/api';

const toneText: Record<PluginTone, string> = {
  default: 'text-text',
  muted: 'text-text-muted',
  ok: 'text-success',
  warn: 'text-warning',
  error: 'text-danger',
};

const toneDot: Record<PluginTone, string> = {
  default: 'bg-border-2',
  muted: 'bg-text-dim',
  ok: 'bg-success',
  warn: 'bg-warning',
  error: 'bg-danger',
};

const figureWidth = { sm: 'w-24', md: 'w-40', lg: 'w-full max-w-md' } as const;

const fieldClass =
  'w-full min-w-0 bg-panel border border-border rounded px-3 py-1.5 text-sm text-text placeholder:text-text-dim focus:outline-none focus:border-accent';

type PressFn = (b: PluginButton) => Promise<boolean>;

export function PluginPage() {
  const { pageId = '' } = useParams<{ pageId: string }>();
  const [page, setPage] = useState<Page | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      setPage(await getPluginPage(pageId));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [pageId]);

  useEffect(() => {
    setPage(null);
    void load();
  }, [load]);

  // Auto-refresh while the page is visible, at the rate the plugin asked for.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const secs = page?.refreshSeconds;
    if (!secs) return;
    timer.current = setTimeout(() => {
      if (document.visibilityState === 'visible') void load();
      else setPage((p) => (p ? { ...p } : p)); // re-arm without fetching
    }, secs * 1000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [page, load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  async function press(button: PluginButton): Promise<boolean> {
    if (button.confirm && !window.confirm(button.confirm)) return false;
    const key = `${button.tool}:${button.label}`;
    setBusy(key);
    try {
      const r = await runPluginPageAction(pageId, button.tool, button.args);
      if (r.page) setPage(r.page);
      setToast(r.ok ? { kind: 'ok', text: `${button.label} ✓` } : { kind: 'err', text: r.error ?? 'failed' });
      return r.ok;
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (err) {
    return (
      <div className="p-6">
        <div className="text-danger text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {err}
        </div>
      </div>
    );
  }
  if (!page) return <div className="p-6 text-text-muted text-sm">Loading…</div>;

  return (
    <div className={clsx('min-h-full', page.theme === 'hologram' && 'page-theme-hologram')}>
      <div className="p-4 sm:p-6 max-w-4xl">
        <div className="flex items-center gap-3 mb-4">
          <PluginIcon name={page.icon} className="w-5 h-5 text-accent" />
          <h1 className="plugin-title text-xl font-semibold flex-1">{page.title}</h1>
          <span className="text-[11px] text-text-muted hidden sm:inline">{page.plugin}</span>
          <Button variant="ghost" size="sm" onClick={() => void load()} title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>

        {page.error && (
          <Card className="plugin-card p-3 mb-4 border-danger/60">
            <div className="text-danger text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {page.error}
            </div>
          </Card>
        )}

        <div className="space-y-4">
          {page.blocks.map((b, i) => (
            <Block key={i} block={b} busy={busy} onPress={press} />
          ))}
        </div>
      </div>

      {toast && (
        <div
          className={clsx(
            'fixed bottom-4 right-4 px-3 py-2 rounded text-sm flex items-center gap-2 border shadow-lg bg-panel',
            toast.kind === 'ok' ? 'border-success text-success' : 'border-danger text-danger',
          )}
        >
          {toast.kind === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.text}
        </div>
      )}
    </div>
  );
}

function Block({ block, busy, onPress }: { block: PluginBlock; busy: string | null; onPress: PressFn }) {
  switch (block.type) {
    case 'heading':
      return <h2 className="plugin-heading text-sm uppercase tracking-wider text-text-muted pt-2">{block.text}</h2>;
    case 'text':
      return <p className={clsx('text-sm whitespace-pre-wrap', toneText[block.tone ?? 'default'])}>{block.text}</p>;
    case 'stats':
      return (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {block.items.map((s, i) => (
            <Card key={i} className="plugin-card p-3">
              <div className="text-[11px] uppercase tracking-wider text-text-muted">{s.label}</div>
              <div className={clsx('text-lg font-semibold mt-1 break-words', toneText[s.tone ?? 'default'])}>{s.value}</div>
              {s.hint && <div className="text-xs text-text-muted mt-0.5">{s.hint}</div>}
            </Card>
          ))}
        </div>
      );
    case 'table':
      return (
        <Card className="plugin-card overflow-x-auto">
          {block.rows.length === 0 ? (
            <div className="p-3 text-sm text-text-muted italic">{block.empty ?? 'Nothing here.'}</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-text-muted border-b border-border">
                  {block.columns.map((c, i) => (
                    <th key={i} className="px-3 py-2 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((r, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    {r.map((cell, j) => (
                      <td key={j} className="px-3 py-2 align-top">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      );
    case 'list':
      return (
        <Card className="plugin-card">
          {block.items.length === 0 ? (
            <div className="p-3 text-sm text-text-muted italic">{block.empty ?? 'Nothing here.'}</div>
          ) : (
            <ul>
              {block.items.map((it, i) => (
                <li key={i} className="px-3 py-2 border-b border-border last:border-0 flex items-start gap-2">
                  <span className={clsx('mt-1.5 w-2 h-2 rounded-full flex-shrink-0', toneDot[it.tone ?? 'default'])} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm break-words">{it.title}</div>
                    {it.subtitle && <div className="text-xs text-text-muted break-words">{it.subtitle}</div>}
                  </div>
                  {it.badge && (
                    <span className="text-[10px] uppercase tracking-wider bg-border-2 rounded px-1.5 py-0.5 flex-shrink-0">{it.badge}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      );
    case 'progress': {
      const pct = block.max > 0 ? Math.round((block.value / block.max) * 100) : 0;
      return (
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span>{block.label}</span>
            <span className="text-text-muted">{block.hint ?? `${pct}%`}</span>
          </div>
          <div className="h-2 rounded bg-border overflow-hidden">
            <div className="plugin-bar h-full bg-accent-2" style={{ width: `${pct}%` }} />
          </div>
        </div>
      );
    }
    case 'actions':
      return (
        <div className="flex flex-wrap gap-2">
          {block.buttons.map((b, i) => (
            <Button key={i} variant={b.variant ?? 'default'} disabled={busy !== null} onClick={() => void onPress(b)}>
              {busy === `${b.tool}:${b.label}` ? '…' : b.label}
            </Button>
          ))}
        </div>
      );
    case 'input':
      return <InputBlock block={block} busy={busy} onPress={onPress} />;
    case 'chart':
      return <PluginChart block={block} />;
    case 'figure':
      return <FigureBlock block={block} />;
    case 'form':
      // Re-mount when the plugin sends new initial values, so the fields show them.
      return <FormBlock key={JSON.stringify(block.fields.map((f) => [f.name, f.value]))} block={block} busy={busy} onPress={onPress} />;
    case 'divider':
      return <hr className="border-border" />;
    default:
      return null;
  }
}

function InputBlock({ block, busy, onPress }: { block: Extract<PluginBlock, { type: 'input' }>; busy: string | null; onPress: PressFn }) {
  const [value, setValue] = useState('');
  const text = value.trim();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text) return;
    const ok = await onPress({ label: block.button, tool: block.tool, args: { ...(block.args ?? {}), [block.arg]: text } });
    if (ok) setValue('');
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-1">
      {block.label && <label className="text-sm text-text-muted">{block.label}</label>}
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={block.placeholder}
          maxLength={block.maxLength}
          className={clsx(fieldClass, 'flex-1')}
        />
        <Button type="submit" variant="primary" disabled={busy !== null || !text}>
          {busy === `${block.tool}:${block.button}` ? '…' : block.button}
        </Button>
      </div>
    </form>
  );
}

/**
 * The SVG is drawn through <img> from a data URI: the browser treats it as a
 * picture, so it can animate but never runs script or fetches anything.
 */
function FigureBlock({ block }: { block: Extract<PluginBlock, { type: 'figure' }> }) {
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(block.svg)}`;
  const body = (
    <div className={clsx('flex gap-4', block.size === 'lg' ? 'flex-col' : 'flex-col sm:flex-row sm:items-start')}>
      <img src={src} alt={block.alt} className={clsx('flex-shrink-0 h-auto', figureWidth[block.size])} loading="lazy" decoding="async" />
      {(block.caption || block.bullets) && (
        <div className="flex-1 min-w-0 text-sm">
          {block.caption && <p className="whitespace-pre-wrap text-text">{block.caption}</p>}
          {block.bullets && (
            <ul className="mt-2 space-y-1 list-disc pl-5 text-text-muted">
              {block.bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );

  if (block.collapsed && block.title) {
    return (
      <Card className="plugin-card">
        <details className="group">
          <summary className="list-none cursor-pointer px-3 py-2 flex items-center gap-2 text-sm font-medium select-none">
            <ChevronRight className="w-4 h-4 text-accent transition-transform group-open:rotate-90" />
            {block.title}
          </summary>
          <div className="px-3 pb-3">{body}</div>
        </details>
      </Card>
    );
  }
  return (
    <Card className="plugin-card p-3">
      {block.title && <div className="text-sm font-medium mb-2">{block.title}</div>}
      {body}
    </Card>
  );
}

type FieldValue = string | number | boolean;

function initialValue(f: PluginFormField): FieldValue {
  if (f.value !== undefined) return f.value;
  switch (f.kind) {
    case 'toggle':
      return false;
    case 'slider':
      return f.min ?? 0;
    case 'select':
      return f.options?.[0]?.value ?? '';
    default:
      return '';
  }
}

function FormBlock({ block, busy, onPress }: { block: Extract<PluginBlock, { type: 'form' }>; busy: string | null; onPress: PressFn }) {
  const [values, setValues] = useState<Record<string, FieldValue>>(() =>
    Object.fromEntries(block.fields.map((f) => [f.name, initialValue(f)])),
  );
  const set = (name: string, v: FieldValue) => setValues((prev) => ({ ...prev, [name]: v }));

  // Empty optional fields are left out; numbers are sent as numbers.
  const args: Record<string, unknown> = { ...(block.args ?? {}) };
  let missing = false;
  for (const f of block.fields) {
    const v = values[f.name];
    if (f.kind === 'toggle' || f.kind === 'slider') {
      args[f.name] = v;
      continue;
    }
    const text = typeof v === 'string' ? v.trim() : String(v ?? '');
    if (text === '') {
      if (f.required) missing = true;
      continue;
    }
    if (f.kind === 'number') {
      const n = Number(text.replace(',', '.'));
      if (!Number.isFinite(n)) {
        missing = true;
        continue;
      }
      args[f.name] = n;
    } else {
      args[f.name] = text;
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (missing) return;
    await onPress({ label: block.button, tool: block.tool, args });
  }

  return (
    <Card className="plugin-card p-3">
      <form onSubmit={(e) => void submit(e)} className="space-y-3">
        {block.title && <div className="text-sm font-medium">{block.title}</div>}
        <div className="grid gap-3 sm:grid-cols-2">
          {block.fields.map((f) => (
            <Field key={f.name} field={f} value={values[f.name] ?? initialValue(f)} onChange={(v) => set(f.name, v)} />
          ))}
        </div>
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={busy !== null || missing}>
            {busy === `${block.tool}:${block.button}` ? '…' : block.button}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Field({ field: f, value, onChange }: { field: PluginFormField; value: FieldValue; onChange: (v: FieldValue) => void }) {
  const id = `field-${f.name}`;
  const label = (
    <label htmlFor={id} className="text-xs text-text-muted flex justify-between gap-2">
      <span>
        {f.label}
        {f.required && <span className="text-danger"> *</span>}
      </span>
      {f.kind === 'slider' && (
        <span className="text-text font-medium">
          {String(value)}
          {f.unit ? ` ${f.unit}` : ''}
        </span>
      )}
    </label>
  );
  const hint = f.hint && <div className="text-[11px] text-text-dim">{f.hint}</div>;
  const wide = f.kind === 'textarea';

  let control;
  switch (f.kind) {
    case 'textarea':
      control = (
        <textarea id={id} value={String(value)} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} maxLength={f.maxLength} rows={3} className={fieldClass} />
      );
      break;
    case 'number':
      control = (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="number"
            inputMode="decimal"
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
            placeholder={f.placeholder}
            min={f.min}
            max={f.max}
            step={f.step ?? 'any'}
            className={fieldClass}
          />
          {f.unit && <span className="text-xs text-text-muted">{f.unit}</span>}
        </div>
      );
      break;
    case 'slider':
      control = (
        <input
          id={id}
          type="range"
          value={Number(value)}
          onChange={(e) => onChange(Number(e.target.value))}
          min={f.min}
          max={f.max}
          step={f.step ?? 1}
          className="w-full accent-accent"
        />
      );
      break;
    case 'select':
      control = (
        <select id={id} value={String(value)} onChange={(e) => onChange(e.target.value)} className={fieldClass}>
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case 'toggle':
      control = (
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className="accent-accent w-4 h-4" />
          <span>{f.placeholder ?? 'Yes'}</span>
        </label>
      );
      break;
    default:
      control = (
        <input id={id} value={String(value)} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} maxLength={f.maxLength} className={fieldClass} />
      );
  }

  return (
    <div className={clsx('flex flex-col gap-1', wide && 'sm:col-span-2')}>
      {label}
      {control}
      {hint}
    </div>
  );
}
