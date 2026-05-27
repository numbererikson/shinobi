import { parseJsonOrNull } from '../lib/json.js';
import type { Subtask, SubtaskRow } from './subtasks.js';

export function hydrate(row: SubtaskRow): Subtask {
  return {
    ...row,
    depends_on: parseJsonOrNull<number[]>(row.depends_on),
    files_touched: parseJsonOrNull<string[]>(row.files_touched),
  };
}
