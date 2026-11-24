// Claude Code hooks → Shinobi dead ends, without relying on the agent to ask.
//
// The repo's .claude/settings.json pipes each hook's JSON input to
// POST /api/hooks/claude-code (see docs/claude-code-hooks.md). We answer with
// Claude Code's hook JSON, adding context only when a past failure is relevant:
//   - UserPromptSubmit: dead ends matching the task the user just described;
//   - PostToolUse (Edit/Write/MultiEdit/NotebookEdit): dead ends recorded for
//     the file just changed, once per file per session.
// Nothing relevant → empty answer, so the agent sees nothing. Every warning is
// logged as activity `dead_end_hook`, which is how usefulness gets measured.

import { recordActivity } from '../../models/activity.js';
import { checkDeadEnds, deadEndsForText, type DeadEnd } from '../../models/dead_ends.js';
import { normalizeFilePath } from '../../lib/paths.js';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SEEN_TTL_MS = 12 * 60 * 60 * 1000;
const SEEN_MAX = 5000;
const seen = new Map<string, number>();

export interface ClaudeCodeHookInput {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: { file_path?: string; notebook_path?: string };
}

export interface ClaudeCodeHookOutput {
  hookSpecificOutput: { hookEventName: string; additionalContext: string };
}

/** True the first time this session sees this key (bounded, time-limited memory). */
function firstTime(key: string, now = Date.now()): boolean {
  const at = seen.get(key);
  if (at !== undefined && now - at < SEEN_TTL_MS) return false;
  if (seen.size >= SEEN_MAX) {
    for (const [k, t] of seen) if (now - t >= SEEN_TTL_MS || seen.size >= SEEN_MAX) seen.delete(k);
  }
  seen.set(key, now);
  return true;
}

export function resetHookMemory(): void {
  seen.clear();
}

function relativeTo(cwd: string | undefined, file: string): string {
  if (cwd && file.startsWith(cwd.endsWith('/') ? cwd : `${cwd}/`)) return file.slice(cwd.length).replace(/^\/+/, '');
  return file;
}

export function formatDeadEnds(intro: string, items: DeadEnd[]): string {
  const lines = items.map((d) => {
    const flag = d.never_retry ? ' [never retry]' : '';
    const files = d.files_involved?.length ? ` (files: ${d.files_involved.slice(0, 3).join(', ')})` : '';
    return `- dead end #${d.id}${flag}: tried "${d.attempted_approach}" — failed because: ${d.failure_reason}${files}`;
  });
  return [
    `Shinobi: ${intro}`,
    ...lines,
    'Do not repeat these unless you know what is different now. If one no longer applies, mark it with update_dead_end (obsolete + reason).',
  ].join('\n');
}

export function handleClaudeCodeHook(input: ClaudeCodeHookInput): ClaudeCodeHookOutput | null {
  const event = input.hook_event_name ?? '';
  const session = input.session_id ?? 'unknown';
  let items: DeadEnd[] = [];
  let intro = '';
  let subject = '';

  if (event === 'UserPromptSubmit' && typeof input.prompt === 'string' && input.prompt.trim()) {
    items = deadEndsForText(input.prompt).filter((d) => firstTime(`${session}:${d.id}`));
    intro = 'past failures that look related to this task:';
    subject = input.prompt.slice(0, 120);
  } else if (event === 'PostToolUse' && EDIT_TOOLS.has(input.tool_name ?? '')) {
    const raw = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
    if (!raw) return null;
    const file = normalizeFilePath(relativeTo(input.cwd, raw));
    if (!file || !firstTime(`${session}:file:${file}`)) return null;
    items = checkDeadEnds({ approach: '', files: [file], limit: 3 }).filter((d) => firstTime(`${session}:${d.id}`));
    intro = `past failures recorded for ${file}:`;
    subject = file;
  } else {
    return null;
  }

  if (items.length === 0) return null;
  try {
    recordActivity({
      project_id: items[0]!.project_id,
      session_id: session,
      action_type: 'dead_end_hook',
      action_details: `[${event}] ${items.map((d) => `#${d.id}`).join(', ')} ← ${subject}`.slice(0, 300),
      entity_type: 'dead_end',
      entity_id: items[0]!.id,
    });
  } catch {
    /* measurement must never break the hook */
  }
  return { hookSpecificOutput: { hookEventName: event, additionalContext: formatDeadEnds(intro, items) } };
}
