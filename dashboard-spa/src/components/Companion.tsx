import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { getCompanion, type CompanionRegister, type CompanionSnapshot } from '../lib/api';

/**
 * Rin — a draggable companion widget. She polls one endpoint and shows the
 * line the reactor produced; everything about *what* she says lives on the
 * server, so this component stays a dumb, movable face.
 */

const POLL_MS = 15_000;
const POSITION_KEY = 'shinobi.companion.position';
const COLLAPSED_KEY = 'shinobi.companion.collapsed';

/** Accent per register, so the tone is readable before you read the words. */
const ACCENT: Record<CompanionRegister, string> = {
  business: 'border-border',
  cheer: 'border-success',
  caution: 'border-warning',
  dry: 'border-accent',
  nag: 'border-warning',
};

interface Position {
  x: number;
  y: number;
}

function loadPosition(): Position | null {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Position>;
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null;
    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}

/** Keep the widget on screen after a window resize or a stale saved position. */
function clamp(position: Position, width: number, height: number): Position {
  const maxX = Math.max(0, window.innerWidth - width);
  const maxY = Math.max(0, window.innerHeight - height);
  return {
    x: Math.min(Math.max(0, position.x), maxX),
    y: Math.min(Math.max(0, position.y), maxY),
  };
}

const WIDGET_WIDTH = 280;
const WIDGET_HEIGHT = 180;

export function Companion() {
  const [snapshot, setSnapshot] = useState<CompanionSnapshot | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === '1');
  const [artFailed, setArtFailed] = useState(false);
  const dragOffset = useRef<Position | null>(null);

  useEffect(() => {
    const saved = loadPosition();
    setPosition(
      clamp(saved ?? { x: window.innerWidth - WIDGET_WIDTH - 24, y: window.innerHeight - WIDGET_HEIGHT - 24 }, WIDGET_WIDTH, WIDGET_HEIGHT),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const next = await getCompanion();
        if (!cancelled) setSnapshot(next);
      } catch {
        // A failed poll is not worth surfacing — she simply keeps her last line.
      }
      if (!cancelled) timer = window.setTimeout(poll, POLL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  // A new pose means a different image; clear the previous failure so a
  // missing `celebrate.webp` doesn't permanently hide an existing `idle.webp`.
  useEffect(() => {
    setArtFailed(false);
  }, [snapshot?.pose]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!position) return;
      dragOffset.current = { x: e.clientX - position.x, y: e.clientY - position.y };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [position],
  );

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const offset = dragOffset.current;
    if (!offset) return;
    setPosition(clamp({ x: e.clientX - offset.x, y: e.clientY - offset.y }, WIDGET_WIDTH, WIDGET_HEIGHT));
  }, []);

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      dragOffset.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
      if (position) localStorage.setItem(POSITION_KEY, JSON.stringify(position));
    },
    [position],
  );

  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      localStorage.setItem(COLLAPSED_KEY, value ? '0' : '1');
      return !value;
    });
  }, []);

  if (!snapshot?.enabled || !position) return null;

  const hasArt = snapshot.available_art.includes(snapshot.pose) && !artFailed;
  const accent = snapshot.register ? ACCENT[snapshot.register] : 'border-border';

  return (
    <div
      className={`hidden md:block fixed z-40 w-[280px] rounded-lg border-2 ${accent} bg-panel shadow-2xl select-none`}
      style={{ left: position.x, top: position.y }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 cursor-move border-b border-border"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className="text-sm font-semibold tracking-wide text-text">{snapshot.name}</span>
        <button
          onClick={toggleCollapsed}
          className="text-text-muted hover:text-accent"
          aria-label={collapsed ? 'Expand companion' : 'Collapse companion'}
        >
          {collapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {!collapsed && (
        <div className="p-3 flex gap-3">
          <div className="shrink-0 w-16 h-20 rounded overflow-hidden bg-bg flex items-center justify-center">
            {hasArt ? (
              <img
                src={`/api/companion/art/${snapshot.pose}`}
                alt={`${snapshot.name} (${snapshot.pose})`}
                className="w-full h-full object-cover"
                onError={() => setArtFailed(true)}
              />
            ) : (
              <span className="text-2xl text-text-muted" title="No artwork installed for this pose">
                {snapshot.name.slice(0, 1)}
              </span>
            )}
          </div>
          <div className="min-w-0">
            {snapshot.line ? (
              <>
                <p className="text-sm text-text leading-snug break-words">{snapshot.line}</p>
                {snapshot.detail && (
                  <p className="mt-1 text-xs text-text-muted break-words">{snapshot.detail}</p>
                )}
              </>
            ) : (
              <p className="text-sm text-text-muted italic">Watching.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
