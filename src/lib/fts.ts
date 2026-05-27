const FTS_RESERVED = /["()*:^-]/g;

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
