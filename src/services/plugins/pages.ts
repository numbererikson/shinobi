import { findPlugin } from './state.js';
import { isModuleEnabled } from '../modules.js';
import { resolveOwnedTool, withTimeout } from './invoke.js';

/**
 * Plugin dashboard pages.
 *
 * A plugin describes a page as data — a list of blocks (stats, tables,
 * buttons, …) — and the dashboard draws it. Plugins never ship UI code, so a
 * page cannot run script in the dashboard, and a single-file plugin stays a
 * single file. Buttons call the page's own plugin tools; nothing else.
 */

export type Tone = 'default' | 'muted' | 'ok' | 'warn' | 'error';

export type PluginBlock =
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string; tone?: Tone }
  | { type: 'stats'; items: { label: string; value: string; hint?: string; tone?: Tone }[] }
  | { type: 'table'; columns: string[]; rows: string[][]; empty?: string }
  | { type: 'list'; items: { title: string; subtitle?: string; badge?: string; tone?: Tone }[]; empty?: string }
  | { type: 'progress'; label: string; value: number; max: number; hint?: string }
  | { type: 'actions'; buttons: PluginButton[] }
  | { type: 'input'; label?: string; placeholder?: string; button: string; tool: string; arg: string; args?: Record<string, unknown>; maxLength: number }
  | { type: 'chart'; kind: 'line' | 'bar'; labels: string[]; series: { name: string; values: (number | null)[] }[]; title?: string; unit?: string }
  | { type: 'figure'; svg: string; alt: string; title?: string; caption?: string; bullets?: string[]; size: FigureSize; collapsed?: boolean }
  | { type: 'form'; tool: string; button: string; title?: string; args?: Record<string, unknown>; fields: FormField[] }
  | { type: 'divider' };

export type FigureSize = 'sm' | 'md' | 'lg';

/** Named colour presets a page may opt into. Plugins pick one; they never ship CSS. */
export type PageTheme = 'default' | 'hologram';

export type FormFieldKind = 'text' | 'textarea' | 'number' | 'select' | 'slider' | 'toggle';

export interface FormField {
  /** Key in the args object the tool receives. */
  name: string;
  label: string;
  kind: FormFieldKind;
  /** Initial value: string for text/textarea/select, number for number/slider, boolean for toggle. */
  value?: string | number | boolean;
  placeholder?: string;
  hint?: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  required?: boolean;
  options?: { value: string; label: string }[];
}

export interface PluginButton {
  label: string;
  /** A tool registered by the same plugin. */
  tool: string;
  args?: Record<string, unknown>;
  /** When set, the dashboard asks for confirmation with this text first. */
  confirm?: string;
  variant?: 'default' | 'primary' | 'danger';
}

export interface PluginPageRender {
  blocks: unknown[];
  /** Re-render every N seconds while the page is open (min 2). */
  refreshSeconds?: number;
}

export interface PluginPageDef {
  /** URL-safe, unique across plugins: /apps/<id>. */
  id: string;
  title: string;
  /** Icon hint from a small fixed set (music, shield, dumbbell, home, chart, list, package). */
  icon?: string;
  /** Optional sort key for the sidebar (lower first). */
  order?: number;
  /** Optional colour preset for this page only (default | hologram). */
  theme?: PageTheme;
  render: () => unknown[] | PluginPageRender | Promise<unknown[] | PluginPageRender>;
}

export interface PluginPageSummary {
  id: string;
  title: string;
  icon: string;
  plugin: string;
}

export interface RenderedPluginPage extends PluginPageSummary {
  theme: PageTheme;
  blocks: PluginBlock[];
  refreshSeconds: number | null;
  error: string | null;
}

const PAGE_ID = /^[a-z][a-z0-9-]{0,39}$/;
const ICONS = new Set(['music', 'shield', 'dumbbell', 'swords', 'home', 'chart', 'list', 'package']);
const THEMES = new Set<PageTheme>(['default', 'hologram']);
const FIGURE_SIZES = new Set<FigureSize>(['sm', 'md', 'lg']);
const FIELD_KINDS = new Set<FormFieldKind>(['text', 'textarea', 'number', 'select', 'slider', 'toggle']);
const MAX_SVG = 100_000;
const MAX_FORM_FIELDS = 30;
const MAX_FIELD_OPTIONS = 50;
/**
 * SVG constructs refused outright. Figures are drawn through <img>, where the
 * browser never runs script or loads external resources, so this list is
 * defence in depth: a figure that needs any of these is dropped, not repaired.
 */
const SVG_FORBIDDEN = [
  /<script/i,
  /<foreignObject/i,
  /<iframe/i,
  /<object/i,
  /<embed/i,
  /<image/i,
  /<!ENTITY/i,
  /<!DOCTYPE/i,
  /\son[a-z]+\s*=/i,
  /javascript:/i,
  /@import/i,
  // Only same-document references (#id) may be linked or used as paint.
  /\bhref\s*=\s*(?:"(?!#)|'(?!#)|(?!["'#\s]))/i,
  /url\(\s*(?:"(?!#)|'(?!#)|(?!["'#\s]))/i,
];
const RENDER_TIMEOUT_MS = 10_000;
const MAX_BLOCKS = 100;
const MAX_ROWS = 500;
const MAX_ITEMS = 200;
const MAX_TEXT = 2000;
const MAX_CHART_POINTS = 90;
/** Four series keep every adjacent colour pair distinguishable for colour-blind readers. */
const MAX_CHART_SERIES = 4;
const TONES = new Set<Tone>(['default', 'muted', 'ok', 'warn', 'error']);
const ARG_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;

interface RegisteredPage {
  plugin: string;
  def: PluginPageDef;
}

const pages = new Map<string, RegisteredPage>();

export function registerPluginPage(pluginName: string, def: PluginPageDef): void {
  if (!def || typeof def !== 'object') throw new Error(`plugin '${pluginName}': page definition must be an object`);
  if (typeof def.id !== 'string' || !PAGE_ID.test(def.id)) {
    throw new Error(`plugin '${pluginName}': page id '${String(def.id)}' must match ${PAGE_ID}`);
  }
  if (typeof def.title !== 'string' || def.title.trim().length === 0) {
    throw new Error(`plugin '${pluginName}': page '${def.id}' needs a title`);
  }
  if (typeof def.render !== 'function') throw new Error(`plugin '${pluginName}': page '${def.id}' needs a render function`);
  const existing = pages.get(def.id);
  if (existing) {
    throw new Error(`plugin '${pluginName}': page id '${def.id}' is already used by plugin '${existing.plugin}'`);
  }
  pages.set(def.id, { plugin: pluginName, def });
  const info = findPlugin(pluginName);
  if (info) info.pages_registered.push(def.id);
}

function summary(p: RegisteredPage): PluginPageSummary {
  return {
    id: p.def.id,
    title: p.def.title.trim().slice(0, 60),
    icon: p.def.icon && ICONS.has(p.def.icon) ? p.def.icon : 'package',
    plugin: p.plugin,
  };
}

export function listPluginPages(): PluginPageSummary[] {
  return [...pages.values()]
    .filter((p) => isModuleEnabled(p.plugin))
    .sort((a, b) => (a.def.order ?? 100) - (b.def.order ?? 100) || a.def.title.localeCompare(b.def.title))
    .map(summary);
}

export function resetPluginPages(): void {
  pages.clear();
}

// ---- sanitising ---------------------------------------------------------------

function str(v: unknown, max = MAX_TEXT): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : (JSON.stringify(v) ?? '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function optStr(v: unknown, max = MAX_TEXT): string | undefined {
  return v === undefined || v === null || v === '' ? undefined : str(v, max);
}

function tone(v: unknown): Tone | undefined {
  return typeof v === 'string' && TONES.has(v as Tone) ? (v as Tone) : undefined;
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** A standalone SVG document safe to draw as an image, or null. */
export function sanitizeSvg(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let svg = raw.trim();
  if (svg.length === 0 || svg.length > MAX_SVG) return null;
  if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>$/i.test(svg)) return null;
  if (SVG_FORBIDDEN.some((re) => re.test(svg))) return null;
  // A data-URI image renders only with the SVG namespace declared.
  if (!/^<svg[^>]*\sxmlns\s*=/i.test(svg)) svg = svg.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return svg;
}

function optNum(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function sanitizeField(raw: unknown): FormField | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  if (typeof f.name !== 'string' || !ARG_NAME.test(f.name)) return null;
  const kind: FormFieldKind = typeof f.kind === 'string' && FIELD_KINDS.has(f.kind as FormFieldKind) ? (f.kind as FormFieldKind) : 'text';
  const field: FormField = { name: f.name, label: str(f.label, 120) || f.name, kind };
  for (const key of ['placeholder', 'hint'] as const) {
    const v = optStr(f[key], 200);
    if (v) field[key] = v;
  }
  const unit = optStr(f.unit, 20);
  if (unit) field.unit = unit;
  if (f.required === true) field.required = true;

  switch (kind) {
    case 'text':
    case 'textarea': {
      field.maxLength = Math.min(Math.max(Math.round(num(f.maxLength)) || (kind === 'text' ? 200 : 1000), 1), MAX_TEXT);
      const v = optStr(f.value, field.maxLength);
      if (v !== undefined) field.value = v;
      break;
    }
    case 'number':
    case 'slider': {
      let min = optNum(f.min);
      let max = optNum(f.max);
      if (kind === 'slider') {
        min ??= 0;
        max ??= 10;
      }
      if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
      if (min !== undefined) field.min = min;
      if (max !== undefined) field.max = max;
      const step = optNum(f.step);
      if (step !== undefined && step > 0) field.step = step;
      let v = optNum(f.value);
      if (v !== undefined) {
        if (min !== undefined) v = Math.max(v, min);
        if (max !== undefined) v = Math.min(v, max);
        field.value = v;
      }
      break;
    }
    case 'select': {
      const options = (Array.isArray(f.options) ? f.options : []).slice(0, MAX_FIELD_OPTIONS).flatMap((o) => {
        if (o && typeof o === 'object') {
          const opt = o as Record<string, unknown>;
          const value = str(opt.value, 80);
          return value ? [{ value, label: str(opt.label, 120) || value }] : [];
        }
        const value = str(o, 80);
        return value ? [{ value, label: value }] : [];
      });
      if (options.length === 0) return null;
      field.options = options;
      const v = optStr(f.value, 80);
      if (v !== undefined && options.some((o) => o.value === v)) field.value = v;
      break;
    }
    case 'toggle':
      field.value = f.value === true;
      break;
  }
  return field;
}

function sanitizeButton(raw: unknown, plugin: string): PluginButton | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.tool !== 'string' || !ownsTool(plugin, b.tool)) return null;
  const args = b.args && typeof b.args === 'object' && !Array.isArray(b.args) ? (b.args as Record<string, unknown>) : undefined;
  const variant = b.variant === 'primary' || b.variant === 'danger' ? b.variant : 'default';
  const out: PluginButton = { label: str(b.label, 60) || b.tool, tool: b.tool, variant };
  if (args) out.args = args;
  const confirm = optStr(b.confirm, 300);
  if (confirm) out.confirm = confirm;
  return out;
}

/**
 * Turn whatever a plugin returned into blocks the dashboard can draw safely:
 * unknown block types and malformed fields are dropped, text is plain and
 * length-capped, buttons may only target the plugin's own tools.
 */
export function sanitizeBlocks(raw: unknown, plugin: string): PluginBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: PluginBlock[] = [];
  for (const item of raw.slice(0, MAX_BLOCKS)) {
    if (!item || typeof item !== 'object') continue;
    const b = item as Record<string, unknown>;
    switch (b.type) {
      case 'heading':
        out.push({ type: 'heading', text: str(b.text, 200) });
        break;
      case 'text': {
        const t = tone(b.tone);
        out.push(t ? { type: 'text', text: str(b.text), tone: t } : { type: 'text', text: str(b.text) });
        break;
      }
      case 'stats': {
        const items = (Array.isArray(b.items) ? b.items : []).slice(0, 24).flatMap((i) => {
          if (!i || typeof i !== 'object') return [];
          const s = i as Record<string, unknown>;
          const entry: { label: string; value: string; hint?: string; tone?: Tone } = { label: str(s.label, 80), value: str(s.value, 80) };
          const hint = optStr(s.hint, 200);
          if (hint) entry.hint = hint;
          const t = tone(s.tone);
          if (t) entry.tone = t;
          return [entry];
        });
        if (items.length) out.push({ type: 'stats', items });
        break;
      }
      case 'table': {
        const columns = (Array.isArray(b.columns) ? b.columns : []).slice(0, 12).map((c) => str(c, 80));
        if (columns.length === 0) break;
        const rows = (Array.isArray(b.rows) ? b.rows : [])
          .slice(0, MAX_ROWS)
          .filter((r): r is unknown[] => Array.isArray(r))
          .map((r) => columns.map((_, i) => str(r[i], 300)));
        const block: Extract<PluginBlock, { type: 'table' }> = { type: 'table', columns, rows };
        const empty = optStr(b.empty, 200);
        if (empty) block.empty = empty;
        out.push(block);
        break;
      }
      case 'list': {
        const items = (Array.isArray(b.items) ? b.items : []).slice(0, MAX_ITEMS).flatMap((i) => {
          if (!i || typeof i !== 'object') return [];
          const s = i as Record<string, unknown>;
          const entry: { title: string; subtitle?: string; badge?: string; tone?: Tone } = { title: str(s.title, 200) };
          const subtitle = optStr(s.subtitle, 400);
          if (subtitle) entry.subtitle = subtitle;
          const badge = optStr(s.badge, 40);
          if (badge) entry.badge = badge;
          const t = tone(s.tone);
          if (t) entry.tone = t;
          return [entry];
        });
        const block: Extract<PluginBlock, { type: 'list' }> = { type: 'list', items };
        const empty = optStr(b.empty, 200);
        if (empty) block.empty = empty;
        out.push(block);
        break;
      }
      case 'progress': {
        const max = Math.max(num(b.max), 0);
        const value = max > 0 ? Math.min(Math.max(num(b.value), 0), max) : 0;
        const block: Extract<PluginBlock, { type: 'progress' }> = { type: 'progress', label: str(b.label, 120), value, max };
        const hint = optStr(b.hint, 200);
        if (hint) block.hint = hint;
        out.push(block);
        break;
      }
      case 'actions': {
        const buttons = (Array.isArray(b.buttons) ? b.buttons : []).slice(0, 12).map((x) => sanitizeButton(x, plugin)).filter((x): x is PluginButton => x !== null);
        if (buttons.length) out.push({ type: 'actions', buttons });
        break;
      }
      case 'input': {
        // A text field + submit button: calls `tool` with { ...args, [arg]: <typed text> }.
        if (typeof b.tool !== 'string' || !ownsTool(plugin, b.tool)) break;
        if (typeof b.arg !== 'string' || !ARG_NAME.test(b.arg)) break;
        const block: Extract<PluginBlock, { type: 'input' }> = {
          type: 'input',
          button: str(b.button, 40) || 'Send',
          tool: b.tool,
          arg: b.arg,
          maxLength: Math.min(Math.max(Math.round(num(b.maxLength)) || 500, 1), MAX_TEXT),
        };
        const label = optStr(b.label, 120);
        if (label) block.label = label;
        const placeholder = optStr(b.placeholder, 120);
        if (placeholder) block.placeholder = placeholder;
        if (b.args && typeof b.args === 'object' && !Array.isArray(b.args)) block.args = b.args as Record<string, unknown>;
        out.push(block);
        break;
      }
      case 'chart': {
        const labels = (Array.isArray(b.labels) ? b.labels : []).slice(0, MAX_CHART_POINTS).map((l) => str(l, 40));
        if (labels.length === 0) break;
        const series = (Array.isArray(b.series) ? b.series : []).slice(0, MAX_CHART_SERIES).flatMap((x) => {
          if (!x || typeof x !== 'object') return [];
          const sr = x as Record<string, unknown>;
          const raw = Array.isArray(sr.values) ? sr.values : [];
          // One value per label; anything missing or non-numeric is a gap.
          const values = labels.map((_, i) => {
            const v = raw[i];
            if (v === null || v === undefined || v === '') return null;
            const n = typeof v === 'number' ? v : Number(v);
            return Number.isFinite(n) ? n : null;
          });
          if (values.every((v) => v === null)) return [];
          return [{ name: str(sr.name, 60) || 'Series', values }];
        });
        if (series.length === 0) break;
        const block: Extract<PluginBlock, { type: 'chart' }> = { type: 'chart', kind: b.kind === 'bar' ? 'bar' : 'line', labels, series };
        const title = optStr(b.title, 120);
        if (title) block.title = title;
        const unit = optStr(b.unit, 20);
        if (unit) block.unit = unit;
        out.push(block);
        break;
      }
      case 'figure': {
        const svg = sanitizeSvg(b.svg);
        if (!svg) break;
        const title = optStr(b.title, 120);
        const size = typeof b.size === 'string' && FIGURE_SIZES.has(b.size as FigureSize) ? (b.size as FigureSize) : 'md';
        const block: Extract<PluginBlock, { type: 'figure' }> = { type: 'figure', svg, alt: str(b.alt, 200) || title || 'Figure', size };
        if (title) block.title = title;
        const caption = optStr(b.caption, 600);
        if (caption) block.caption = caption;
        const bullets = (Array.isArray(b.bullets) ? b.bullets : []).slice(0, 8).map((x) => str(x, 240)).filter((x) => x.length > 0);
        if (bullets.length) block.bullets = bullets;
        // Collapsing needs a title to click on.
        if (b.collapsed === true && title) block.collapsed = true;
        out.push(block);
        break;
      }
      case 'form': {
        // Several fields + one submit: calls `tool` with { ...args, <name>: <value>, … }.
        if (typeof b.tool !== 'string' || !ownsTool(plugin, b.tool)) break;
        const seen = new Set<string>();
        const fields = (Array.isArray(b.fields) ? b.fields : []).slice(0, MAX_FORM_FIELDS).flatMap((x) => {
          const field = sanitizeField(x);
          if (!field || seen.has(field.name)) return [];
          seen.add(field.name);
          return [field];
        });
        if (fields.length === 0) break;
        const block: Extract<PluginBlock, { type: 'form' }> = { type: 'form', tool: b.tool, button: str(b.button, 40) || 'Save', fields };
        const title = optStr(b.title, 120);
        if (title) block.title = title;
        if (b.args && typeof b.args === 'object' && !Array.isArray(b.args)) block.args = b.args as Record<string, unknown>;
        out.push(block);
        break;
      }
      case 'divider':
        out.push({ type: 'divider' });
        break;
      default:
        break;
    }
  }
  return out;
}

function ownsTool(plugin: string, tool: string): boolean {
  return resolveOwnedTool(plugin, tool) !== null;
}

// ---- render & actions ---------------------------------------------------------

export async function renderPluginPage(id: string): Promise<RenderedPluginPage | null> {
  const page = pages.get(id);
  if (!page || !isModuleEnabled(page.plugin)) return null;
  const theme: PageTheme = page.def.theme && THEMES.has(page.def.theme) ? page.def.theme : 'default';
  const base = { ...summary(page), theme };
  try {
    const result = await withTimeout(Promise.resolve().then(() => page.def.render()), RENDER_TIMEOUT_MS, `page '${id}'`);
    const rawBlocks = Array.isArray(result) ? result : (result as PluginPageRender | null)?.blocks;
    const refresh = Array.isArray(result) ? undefined : (result as PluginPageRender | null)?.refreshSeconds;
    return {
      ...base,
      blocks: sanitizeBlocks(rawBlocks, page.plugin),
      refreshSeconds: typeof refresh === 'number' && refresh > 0 ? Math.max(2, Math.round(refresh)) : null,
      error: null,
    };
  } catch (err) {
    return { ...base, blocks: [], refreshSeconds: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export type PageActionResult =
  | { status: 'not_found' }
  | { status: 'forbidden'; error: string }
  | { status: 'ok'; result: unknown; page: RenderedPluginPage }
  | { status: 'failed'; error: string; page: RenderedPluginPage };

/** Run one of the page's plugin tools (a button press), then re-render the page. */
export async function runPluginPageAction(id: string, tool: string, args: Record<string, unknown>): Promise<PageActionResult> {
  const page = pages.get(id);
  if (!page || !isModuleEnabled(page.plugin)) return { status: 'not_found' };
  const handler = resolveOwnedTool(page.plugin, tool);
  if (!handler) {
    return { status: 'forbidden', error: `tool '${tool}' does not belong to plugin '${page.plugin}'` };
  }
  let result: unknown;
  let error: string | null = null;
  try {
    result = await withTimeout(Promise.resolve().then(() => handler(args)), RENDER_TIMEOUT_MS, `tool '${tool}'`);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const rendered = (await renderPluginPage(id))!;
  return error === null ? { status: 'ok', result, page: rendered } : { status: 'failed', error, page: rendered };
}
