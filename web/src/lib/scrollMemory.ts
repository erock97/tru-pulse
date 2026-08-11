// Where the leader was scrolled to in an agent's 1:1 sheet, remembered per
// agent for the life of the tab. sessionStorage rather than localStorage: a
// scroll offset is worth restoring on a tab switch or refresh, but a week-old
// offset restored into a re-laid-out page would be noise.
//
// The store is injected so this is testable in the node environment the web
// package's vitest config uses, where `window` does not exist.

export type ScrollStore = Pick<Storage, 'getItem' | 'setItem'>;

export function scrollKey(agentId: string): string {
  return `pulse:1on1scroll:${agentId}`;
}

/** Best-effort: a storage failure must never break the sheet. */
export function saveScroll(store: ScrollStore | null, key: string, y: number): void {
  if (!store) return;
  try {
    store.setItem(key, String(Math.round(y)));
  } catch {
    /* private mode, quota, disabled storage — nothing to do */
  }
}

/** The saved offset, or null when absent or unusable. */
export function readScroll(store: ScrollStore | null, key: string): number | null {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}
