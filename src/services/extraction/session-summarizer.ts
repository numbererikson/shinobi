import { getDb } from '../../lib/db.js';
import { listActivity } from '../../models/activity.js';
import { listDeadEnds } from '../../models/dead_ends.js';
import { listDecisions } from '../../models/decisions.js';
import { listSubtasks } from '../../models/subtasks.js';
import { llmProviderFromEnv } from '../llm/factory.js';
import type { LLMMessage } from '../llm/types.js';

const SYSTEM_PROMPT = `You compress a Shinobi project's recent session history into exactly 3 short paragraphs of markdown.

Use these exact H3 headers and order:

### Recent work
What was claimed/completed/changed in the last sessions. Reference specific subtask IDs (#N) and titles when notable. 3-5 sentences.

### Decisions logged
Key recent decisions. Include kind in brackets and a one-line essence per decision. 2-4 sentences (or a short bullet list if more than 3 distinct decisions).

### Dead ends and open follow-ups
What approaches failed (cite the failure_reason briefly) plus what's pending. If nothing failed and nothing is blocked, state that explicitly. 2-4 sentences.

Tone: terse, factual, present tense. NO marketing language. NO preamble before the first header. NO trailing meta-commentary. Output ONLY the 3 paragraphs.`;

const MAX_INPUT_CHARS = 16000;

export interface SummarizerInput {
  projectId: number;
  activityLimit?: number;
  decisionsLimit?: number;
  deadEndsLimit?: number;
  openSubtasksLimit?: number;
}

export interface SummaryResult {
  summary: string;
  provider: string;
  model: string;
  input_chars: number;
  truncated: boolean;
}

function buildContextBlock(input: Required<SummarizerInput>): string {
  const activity = listActivity({ projectId: input.projectId, limit: input.activityLimit });
  const decisions = listDecisions({ projectId: input.projectId, limit: input.decisionsLimit });
  const deadEnds = listDeadEnds({ projectId: input.projectId, limit: input.deadEndsLimit });
  const openSubtasks = listSubtasks({ projectId: input.projectId, status: 'todo' }).slice(
    0,
    input.openSubtasksLimit,
  );

  const lines: string[] = [];

  lines.push('### Activity timeline (newest first)');
  if (activity.length === 0) {
    lines.push('(no recent activity)');
  } else {
    for (const a of activity) {
      lines.push(
        `- ${a.created_at} | ${a.action_type} | ${a.entity_type ?? ''}#${a.entity_id ?? '?'} | ${
          (a.action_details ?? '').replace(/\s+/g, ' ').slice(0, 140)
        }`,
      );
    }
  }
  lines.push('');

  lines.push('### Decisions (newest first)');
  if (decisions.length === 0) {
    lines.push('(none)');
  } else {
    for (const d of decisions) {
      lines.push(`- [#${d.id} ${d.kind} ${d.status}] ${d.summary}`);
      lines.push(`  rationale: ${d.rationale.replace(/\s+/g, ' ').slice(0, 240)}`);
    }
  }
  lines.push('');

  lines.push('### Dead ends (newest first)');
  if (deadEnds.length === 0) {
    lines.push('(none)');
  } else {
    for (const de of deadEnds) {
      lines.push(`- [#${de.id}] tried: ${de.attempted_approach.slice(0, 120)}`);
      lines.push(`  failed because: ${de.failure_reason.replace(/\s+/g, ' ').slice(0, 200)}`);
    }
  }
  lines.push('');

  lines.push('### Open subtasks (top by priority)');
  if (openSubtasks.length === 0) {
    lines.push('(none)');
  } else {
    for (const s of openSubtasks) {
      lines.push(`- [#${s.id} ${s.priority}] ${s.title}`);
    }
  }

  return lines.join('\n');
}

export async function summarizeProject(input: SummarizerInput): Promise<SummaryResult> {
  const provider = llmProviderFromEnv();
  if (!provider) {
    throw new Error(
      'No LLM provider configured for session summarization. Set SHINOBI_LLM_PROVIDER + SHINOBI_LLM_API_KEY (or GROQ_API_KEY / OPENAI_API_KEY).',
    );
  }

  const filled: Required<SummarizerInput> = {
    projectId: input.projectId,
    activityLimit: input.activityLimit ?? 50,
    decisionsLimit: input.decisionsLimit ?? 12,
    deadEndsLimit: input.deadEndsLimit ?? 8,
    openSubtasksLimit: input.openSubtasksLimit ?? 8,
  };

  const fullContext = buildContextBlock(filled);
  const inputChars = fullContext.length;
  const truncated = inputChars > MAX_INPUT_CHARS;
  const context = truncated ? fullContext.slice(0, MAX_INPUT_CHARS) : fullContext;

  const messages: LLMMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Project context:\n\n${context}` },
  ];

  const result = await provider.complete(messages, {
    temperature: 0.2,
    maxTokens: 700,
  });

  return {
    summary: result.text.trim(),
    provider: result.provider,
    model: result.model,
    input_chars: inputChars,
    truncated,
  };
}

export function persistSummary(
  projectId: number,
  summary: string,
  providerLabel: string,
): void {
  getDb()
    .prepare(
      `UPDATE projects
       SET recent_summary_md = ?,
           recent_summary_at = CURRENT_TIMESTAMP,
           recent_summary_provider = ?
       WHERE id = ?`,
    )
    .run(summary, providerLabel, projectId);
}
