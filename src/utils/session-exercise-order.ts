/**
 * Pure helpers for the per-session EXERCISE display order.
 *
 * Run-id: 2026-06-01_0941_session-finish-exercise-order
 *
 * The bug: History derived exercise order from the `set_number`-tie-broken set
 * query, which diverges from the order the user saw on the live screen. The fix
 * persists an explicit `session_exercise_order` (an ordered `exercise_id[]`) and
 * History orders its exercise blocks by it, with a deterministic fallback for
 * legacy sessions whose column is NULL.
 *
 * These functions are extracted so the ordering logic is covered by
 * deterministic unit tests independent of the React screen. They operate on
 * plain id arrays (`string[]`) — the same shape the screen derives from its
 * exercise rows.
 */

/**
 * Stable-sort a list of discovered exercise ids by a persisted order array.
 *
 * Contract:
 *  - Ids present in `persistedOrder` come first, in `persistedOrder`'s index
 *    order (ascending).
 *  - Ids NOT present in `persistedOrder` (legacy NULL → empty array, or an
 *    exercise added in History edit after the snapshot) keep their relative
 *    order from `discoveredIds` (first-occurrence) and are APPENDED after the
 *    ordered ones.
 *  - Ids in `persistedOrder` that are NOT in `discoveredIds` are ignored
 *    (a stale/never-logged/removed id can't be rendered — there is no row for
 *    it), so they never appear in the output.
 *  - The output contains exactly the members of `discoveredIds`, each once,
 *    preserving any duplicates' first occurrence (callers pass de-duped ids).
 *
 * @param discoveredIds   exercise ids discovered for the session, in
 *                        first-occurrence order (the legacy/fallback order).
 * @param persistedOrder  the `session_exercise_order` array (NULL → pass `null`
 *                        or `[]`); ids the user's persisted order specifies.
 */
export function orderExerciseIds(
  discoveredIds: readonly string[],
  persistedOrder: readonly string[] | null | undefined,
): string[] {
  const order = persistedOrder ?? [];
  if (order.length === 0) {
    // Legacy / no persisted order → keep the deterministic first-occurrence
    // order exactly as today (legacy sessions do not start reshuffling).
    return [...discoveredIds];
  }

  const discovered = new Set(discoveredIds);
  // Rank only the persisted ids that actually exist in the discovered set.
  const rank = new Map<string, number>();
  for (const id of order) {
    if (discovered.has(id) && !rank.has(id)) {
      rank.set(id, rank.size);
    }
  }

  const ordered: string[] = [];
  const appended: string[] = [];
  for (const id of discoveredIds) {
    if (rank.has(id)) ordered.push(id);
    else appended.push(id);
  }
  // `ordered` follows discovered order; re-sort it by the persisted rank so the
  // persisted sequence wins for the ids it covers. Stable for equal ranks
  // (ids are unique within `discoveredIds`, so ranks are unique here).
  ordered.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));

  return [...ordered, ...appended];
}
