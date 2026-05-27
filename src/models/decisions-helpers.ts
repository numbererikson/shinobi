import { parseJsonOrNull } from '../lib/json.js';
import type { Decision, DecisionRow } from './decisions.js';

export function hydrate(row: DecisionRow): Decision {
  return {
    ...row,
    files_touched: parseJsonOrNull<string[]>(row.files_touched),
    tags: parseJsonOrNull<string[]>(row.tags),
  };
}
