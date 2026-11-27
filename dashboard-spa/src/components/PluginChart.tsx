import { useEffect, useRef, useState } from 'react';
import { Card } from './ui/Card';
import type { PluginBlock } from '../lib/api';

type ChartBlock = Extract<PluginBlock, { type: 'chart' }>;

// Categorical slots stepped for the dark panel (#161b22), in fixed order —
// colour follows the series' position, never its value. Validated: lightness
// band, chroma floor, adjacent-pair CVD ΔE ≥ 8.4, normal-vision ΔE ≥ 19.8,
// ≥ 3:1 contrast. The host caps charts at four series to stay inside this set.
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500'];

const HEIGHT = 200;
const M = { top: 10, right: 12, bottom: 24, left: 44 };

function niceStep(range: number, ticks: number): number {
  const raw = range / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
}

function fmt(n: number): string {
  if (Math.abs(n) >= 10000) return `${Math.round(n / 1000)}k`;
  return Number.isInteger(n) ? String(n) : n.toFixed(Math.abs(n) < 10 ? 2 : 1).replace(/\.?0+$/, '');
}

/** Path for a bar with 4px rounded corners on its data end only; anchored square on the baseline. */
function barPath(x: number, w: number, yZero: number, yVal: number): string {
  const r = Math.min(4, w / 2, Math.abs(yZero - yVal));
  if (yVal <= yZero) {
    return `M${x},${yZero}V${yVal + r}Q${x},${yVal} ${x + r},${yVal}H${x + w - r}Q${x + w},${yVal} ${x + w},${yVal + r}V${yZero}Z`;
  }
  return `M${x},${yZero}V${yVal - r}Q${x},${yVal} ${x + r},${yVal}H${x + w - r}Q${x + w},${yVal} ${x + w},${yVal - r}V${yZero}Z`;
}

export function PluginChart({ block }: { block: ChartBlock }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, Math.floor(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { labels, series, kind, unit } = block;
  const n = labels.length;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  // Bars must start at zero; lines may zoom in on their range.
  if (kind === 'bar') {
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  }
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const step = niceStep(hi - lo, 4);
  const yMin = Math.floor(lo / step) * step;
  const yMax = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = yMin; t <= yMax + step / 2; t += step) ticks.push(Number(t.toPrecision(12)));

  const plotW = width - M.left - M.right;
  const plotH = HEIGHT - M.top - M.bottom;
  const band = plotW / n;
  const xCenter = (i: number) => M.left + band * i + band / 2;
  const y = (v: number) => M.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 70))));
  const yZero = y(Math.min(Math.max(0, yMin), yMax));

  const groupW = Math.min(band * 0.72, 28 * series.length + 2 * (series.length - 1));
  const barW = Math.max(2, (groupW - 2 * (series.length - 1)) / series.length);

  const withUnit = (v: number) => (unit ? `${fmt(v)} ${unit}` : fmt(v));

  return (
    <Card className="p-3">
      {(block.title || series.length > 1) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2">
          {block.title && <div className="text-sm text-text flex-1 min-w-0">{block.title}</div>}
          {series.length > 1 &&
            series.map((s, i) => (
              <span key={i} className="flex items-center gap-1.5 text-xs text-text-muted">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: SERIES[i] }} />
                {s.name}
              </span>
            ))}
        </div>
      )}
      <div ref={wrap} className="relative" onMouseLeave={() => setHover(null)}>
        <svg width={width} height={HEIGHT} role="img" aria-label={block.title ?? series.map((s) => s.name).join(', ')} className="block">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
              <text x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} className="fill-text-muted">
                {fmt(t)}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            i % labelEvery === 0 ? (
              <text key={i} x={xCenter(i)} y={HEIGHT - 6} textAnchor="middle" fontSize={11} className="fill-text-muted">
                {l.length > 12 ? `${l.slice(0, 11)}…` : l}
              </text>
            ) : null,
          )}

          {hover !== null && kind === 'line' && (
            <line x1={xCenter(hover)} x2={xCenter(hover)} y1={M.top} y2={M.top + plotH} className="stroke-text-dim" strokeWidth={1} />
          )}

          {kind === 'bar'
            ? series.map((s, si) =>
                s.values.map((v, i) => {
                  if (v === null) return null;
                  const x = xCenter(i) - groupW / 2 + si * (barW + 2);
                  return <path key={`${si}-${i}`} d={barPath(x, barW, yZero, y(v))} fill={SERIES[si]} opacity={hover === null || hover === i ? 1 : 0.55} />;
                }),
              )
            : series.map((s, si) => {
                // Break the line at gaps instead of bridging them.
                const segments: string[] = [];
                let cur = '';
                const lone: number[] = [];
                s.values.forEach((v, i) => {
                  if (v === null) {
                    if (cur) segments.push(cur);
                    cur = '';
                    return;
                  }
                  const prevNull = i === 0 || s.values[i - 1] === null;
                  const nextNull = i === n - 1 || s.values[i + 1] === null;
                  if (prevNull && nextNull) lone.push(i);
                  cur += `${cur ? 'L' : 'M'}${xCenter(i)},${y(v)}`;
                });
                if (cur) segments.push(cur);
                return (
                  <g key={si}>
                    {segments.map((d, k) => (
                      <path key={k} d={d} fill="none" stroke={SERIES[si]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    ))}
                    {lone.map((i) => (
                      <circle key={i} cx={xCenter(i)} cy={y(s.values[i] as number)} r={3} fill={SERIES[si]} />
                    ))}
                    {hover !== null && s.values[hover] !== null && (
                      <circle cx={xCenter(hover)} cy={y(s.values[hover] as number)} r={4} fill={SERIES[si]} className="stroke-panel" strokeWidth={2} />
                    )}
                  </g>
                );
              })}

          {/* Hit targets: a full-height column per label, wider than any mark. */}
          {labels.map((_, i) => (
            <rect key={i} x={M.left + band * i} y={M.top} width={band} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
          ))}
        </svg>

        {hover !== null && (
          <div
            className="absolute pointer-events-none bg-bg border border-border-2 rounded px-2 py-1.5 text-xs shadow-lg"
            style={{
              top: M.top,
              left: Math.max(0, Math.min(xCenter(hover) + 10, width - 160)),
              minWidth: 120,
            }}
          >
            <div className="text-text-muted mb-1">{labels[hover]}</div>
            {series.map((s, i) => (
              <div key={i} className="flex items-center gap-1.5 text-text">
                <span className="inline-block w-2 h-2 rounded-sm" style={{ background: SERIES[i] }} />
                <span className="flex-1">{s.name}</span>
                <span className="tabular-nums">{s.values[hover] === null ? '—' : withUnit(s.values[hover] as number)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <details className="mt-2">
        <summary className="text-xs text-text-muted cursor-pointer select-none">Show data</summary>
        <div className="overflow-x-auto mt-2">
          <table className="text-xs w-full">
            <thead>
              <tr className="text-left text-text-muted border-b border-border">
                <th className="px-2 py-1 font-medium" />
                {series.map((s, i) => (
                  <th key={i} className="px-2 py-1 font-medium">
                    {s.name}
                    {unit ? ` (${unit})` : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labels.map((l, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-2 py-1 text-text-muted">{l}</td>
                  {series.map((s, si) => (
                    <td key={si} className="px-2 py-1 tabular-nums">
                      {s.values[i] === null ? '—' : fmt(s.values[i] as number)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}
