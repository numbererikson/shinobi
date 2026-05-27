import { parseJsonOrNull } from '../lib/json.js';
import type { DeadEnd, DeadEndRow } from './dead_ends.js';

export function hydrate(row: DeadEndRow): DeadEnd {
  return {
    ...row,
    files_involved: parseJsonOrNull<string[]>(row.files_involved),
    never_retry: row.never_retry === 1,
  };
}
