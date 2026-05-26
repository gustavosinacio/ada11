import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Picks a canonical (`user_id IS NULL`) exercise via the admin client.
 *
 * Replaces the per-spec `.eq("user_id", userId)` pattern that broke when
 * exercises moved to a shared catalog (migration
 * `0011_canonical_exercises.sql`). With canonical rows owned by `user_id =
 * NULL` and visible to every authenticated user via the widened RLS SELECT
 * policy, the seeded "Bench Press" / "Squat (Barbell)" / etc. names now
 * live once for the whole table — every test reads the same shared rows.
 *
 * Contract:
 *   - If `preferred` is supplied and matches a visible canonical row,
 *     returns that row.
 *   - If `preferred` is supplied but no visible canonical row matches
 *     (either the name doesn't exist or the row carries
 *     `deleted_at IS NOT NULL`), **throws**. The previous behaviour was a
 *     silent fallback to the first canonical row name-ordered ASC, which
 *     masked the soft-deleted-canonical leak surfaced in test report v1
 *     (run `2026-05-25_1921_canonical-exercises`). Specs that depend on a
 *     specific name should fail loudly when that name disappears, so the
 *     next leak surfaces as a spec error and not a misleading 15s timeout
 *     in the UI assertion.
 *   - If `preferred` is omitted, returns the first row name-ordered ASC
 *     (deterministic for parallel-ish runs).
 *
 * Why `admin` (service role) and not the signed-in user client: convention
 * across the e2e suite — tests read setup data via admin, the
 * system-under-test is the user client. Switching to a user client would
 * also work post-migration (canonical visible via RLS) but would change
 * the implicit contract and require sign-in plumbing for setup-only reads.
 */
export async function pickCanonicalExercise(
  admin: SupabaseClient,
  preferred?: string,
): Promise<{ id: string; name: string }> {
  const { data, error } = await admin
    .from("exercises")
    .select("id, name")
    .is("user_id", null)
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error || !data || data.length === 0) {
    throw new Error(
      `pickCanonicalExercise: no canonical rows (${error?.message ?? "empty"})`,
    );
  }
  if (preferred) {
    const match = data.find((r) => r.name === preferred);
    if (match) return { id: match.id as string, name: match.name as string };
    throw new Error(
      `Canonical exercise '${preferred}' not found or is hidden (deleted_at IS NOT NULL)`,
    );
  }
  return {
    id: data[0]!.id as string,
    name: data[0]!.name as string,
  };
}
