/**
 * File-path normalization for files_touched metadata.
 *
 * The brain is shared across devices that see the same repo at different
 * absolute roots (laptop `c:\laragon\www\<repo>\...`, cloud sessions
 * `/home/user/<repo>/...`, containers `/app/...`). Lookups in
 * decisions_for_file / file_context match by string, so paths are stored
 * repo-relative with forward slashes and matched with a suffix fallback for
 * legacy absolute entries.
 */

const ABSOLUTE_ROOT_PATTERNS: RegExp[] = [
  // Windows dev roots: c:/laragon/www/<repo>/..., d:/projects/<repo>/...
  /^[a-z]:\/(?:laragon\/www|projects|code|dev|repos|source|sites|www|htdocs|xampp\/htdocs)\/[^/]+\//i,
  // Windows user checkouts: c:/users/<user>/(documents/)?(projects|code|...)/<repo>/...
  /^[a-z]:\/users\/[^/]+\/(?:documents\/)?(?:projects|code|dev|repos|source|www)\/[^/]+\//i,
  // Unix home checkouts: /home/<user>/<repo>/..., /Users/<user>/<repo>/...
  /^\/(?:home|users)\/[^/]+\/[^/]+\//i,
  // Tilde shorthand: ~/<repo>/...
  /^~\/[^/]+\//,
  // Container / server roots: /app/..., /workspace/..., /var/www/<site>/..., /srv/<site>/...
  /^\/(?:app|workspace|data)\//,
  /^\/(?:workspaces|var\/www|srv)\/[^/]+\//,
];

/**
 * Normalize a single path: backslashes to forward slashes, collapse duplicate
 * slashes, strip a recognized absolute workspace root. Unrecognized absolute
 * paths and already-relative paths pass through (slash-normalized) unchanged.
 */
export function normalizeFilePath(raw: string): string {
  let p = raw.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  for (const pattern of ABSOLUTE_ROOT_PATTERNS) {
    const match = p.match(pattern);
    if (match) {
      p = p.slice(match[0].length);
      break;
    }
  }
  return p;
}

/** Normalize and dedupe a files_touched list. Returns null for empty input. */
export function normalizeFilesTouched(
  files: string[] | null | undefined,
): string[] | null {
  if (!files || files.length === 0) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const file of files) {
    const normalized = normalizeFilePath(file);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out.length > 0 ? out : null;
}

/**
 * Whether two paths refer to the same file once normalized. Suffix matching
 * covers legacy rows stored with absolute roots the patterns don't recognize:
 * `some/unknown/root/src/db.ts` still matches a query for `src/db.ts`.
 * Case-insensitive because Windows paths arrive in mixed case.
 */
export function filePathsMatch(a: string, b: string): boolean {
  const na = normalizeFilePath(a).toLowerCase();
  const nb = normalizeFilePath(b).toLowerCase();
  if (!na || !nb) return false;
  return na === nb || na.endsWith(`/${nb}`) || nb.endsWith(`/${na}`);
}
