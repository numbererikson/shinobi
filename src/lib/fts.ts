const FTS_RESERVED = /["()*:^-]/g;

const STOPWORDS = new Set(
  (
    'this that with from have will would should could what when where which there their about into then than ' +
    'just make made also only some more most very your yours they them were been being does done doing ' +
    'please need want like using used use file files code ' +
    'koji koja koje kako zato samo jos jer ali nije nisu sada mozes moze trebam treba hocu ovaj ova ovo taj ' +
    'neki neka neko kada gdje sto napravi dodaj'
  ).split(' '),
);

/** Distinct significant words of a free-text prompt (lowercase, 4+ letters, no stopwords). */
export function significantTokens(input: string, max = 12): string[] {
  const seen = new Set<string>();
  for (const raw of input.toLowerCase().split(/[^\p{L}\p{N}_]+/u)) {
    if (raw.length < 4 || STOPWORDS.has(raw) || /^\d+$/.test(raw)) continue;
    seen.add(raw);
    if (seen.size >= max) break;
  }
  return [...seen];
}

/** FTS5 query matching ANY of the tokens (for ranking free text, not exact search). */
export function ftsAnyQuery(tokens: string[]): string {
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}

export function escapeFtsQuery(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '') return '';
  const safe = trimmed.replace(FTS_RESERVED, ' ').replace(/\s+/g, ' ').trim();
  if (safe === '') return '';
  return safe
    .split(' ')
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(' ');
}
