import { supabase } from "~/lib/supabase";

const PAGE = 1000;

/**
 * Minimal projection for streak math: every finished, non-deleted session's
 * `started_at`. Lifetime scope; paginated read via `.range()` for safety
 * (a 3-year user has ~500 sessions, well under 1000, but the loop costs
 * nothing if data ever grows beyond).
 *
 * `sessions.started_at` is `NOT NULL` in the schema, so no
 * `.not("started_at", "is", null)` filter is needed.
 */
export async function listFinishedSessionStartedAts(): Promise<
  { started_at: string }[]
> {
  let from = 0;
  const all: { started_at: string }[] = [];
  while (true) {
    const { data, error } = await supabase
      .from("sessions")
      .select("started_at")
      .is("deleted_at", null)
      .not("ended_at", "is", null)
      .order("started_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as { started_at: string }[];
    all.push(...page);
    if (page.length < PAGE) break;
    from += PAGE;
  }
  return all;
}
