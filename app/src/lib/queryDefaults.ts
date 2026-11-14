/** Read-only query defaults for perceived speed (L73). */

/** Keep list/board data warm briefly so revisiting a screen is instant. */
export const READ_STALE_MS = 60_000;
export const READ_GC_MS = 5 * 60_000;

export const readQueryOptions = {
  staleTime: READ_STALE_MS,
  gcTime: READ_GC_MS,
} as const;

/** Query key prefixes that must stay fresh (writes / live entry). */
export const LIVE_QUERY_PREFIXES = ["service", "inventory", "stock", "corrections-count"] as const;

export function isLiveQueryKey(key: unknown): boolean {
  const head = Array.isArray(key) ? String(key[0] ?? "") : "";
  return LIVE_QUERY_PREFIXES.some((prefix) => head === prefix || head.startsWith(`${prefix}-`));
}
