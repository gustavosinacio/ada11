# Validation v2 — 2026-05-19_2353_measurements-tracking

Reviewing: `design-v2.md` (response to `validation-v1.md`'s 2 majors + 7 minors `no-go`)

## Issues raised in previous validation

| Tag | Severity | Addressed? | Notes |
|---|---|---|---|
| **MAJ-1** seed_new_user rewrite footgun | major | **yes** | Decision 18 (design-v2:34) + §user_preferences changes (design-v2:398). Chose Path A — drop the rewrite entirely; `length_unit DEFAULT 'cm'` covers both backfill and new INSERTs. Verified against `supabase/migrations/0004_exercise_muscles_array.sql:50` — the existing INSERT lists only `(user_id, weight_unit)`, so the new column's default fires for fresh signups. The 31-exercise block stays untouched; `tests/seed-and-auth.test.ts:52` `≥ 25` assertion is preserved. |
| **MAJ-2** duplicate same-day strategy missing | major | **yes** | Decision 16 step (e) (design-v2:32) + §DB columns indexes (design-v2:375) + §API surface `DuplicateMeasurementDateError` (design-v2:151-156, 165) + §Screen 2 banner spec (design-v2:451-453). Path 1 chosen — UNIQUE partial expression index + typed client-side error + UI banner with deep-link to existing entry. |
| **MIN-1** Drizzle index DESC inconsistency | minor | **yes** | Confirmed `DESC` claim removed from BOTH the column-shape table (design-v2:374, "plain ASC") AND §Riscos (design-v2:539, "The earlier v1 wording claiming `DESC` is dropped"). Drizzle source (design-v2:93-96) uses `.on(t.userId, t.measuredAt)` — plain ASC, matching `schema.ts:122` precedent. |
| **MIN-2** asymmetric CHECK constraints | minor | **yes** | Decision 3 (design-v2:19) + migration step (a) (design-v2:32) + §user_preferences changes (design-v2:385-396). The migration adds `user_preferences_weight_unit_check` BEFORE adding the new `length_unit` column, in the same transaction. |
| **MIN-3** incoherent form schema | minor | **yes** | New file `src/utils/measurements-form.ts` (design-v2:45, 200-327) — schema is fully string-shaped (`optStr = z.string().trim().optional().or(z.literal(""))`), `buildSubmitPayload` runs parse → range-check → at-least-one-metric refine. Verified pattern matches `routines/new.tsx:12-15` and `exercises/new.tsx:14-21` (string schemas + transform-on-submit). zodResolver works as-is with string schemas; throwing `z.ZodError` from `buildSubmitPayload` and forwarding to `setError` is conventional. |
| **MIN-4** 12-field wall | minor | **yes** | §Screen 2 6-section table (design-v2:434-442) + section header className matches `app/(app)/profile.tsx:26-27,74-75`. **Cosmetic divergence**: design says `mt-4 mb-2 text-sm font-medium uppercase text-gray-500`; profile uses bare `mb-2 text-sm font-medium uppercase text-gray-500` (no `mt-4`). Functionally fine; flagged below as MIN-2026.05-1. |
| **MIN-5** date-fns/parse citation | minor | **yes** | §Riscos (design-v2:553) now cites `package.json:31` (`"date-fns": "^4.1.0"`). Verified. |
| **MIN-6** duplicate delete-confirm copy | minor | **yes** | §Empty-state table + §Screen 3 (design-v2:462, 516) both say `"This entry will be hidden from your history."` consistently. The longer "restore the database" wording is gone. |
| **MIN-7** tab insertion not pinned | minor | **partial** | Decision 7 + §Tab placement (design-v2:493-495) name explicit anchor lines, but the cited line numbers are off by one — see MIN-2026.05-2 below. The intent (insert between `history` and `profile`) is unambiguous; the Implementer will still produce the correct order. |

All 9 v1 issues are addressed in v2. The two majors are fully resolved. Two of the seven minors land with cosmetic-precision issues (MIN-2026.05-1 and MIN-2026.05-2 below), neither blocking.

## Verification of v2-new claims

| Claim | Verified? | Evidence |
|---|---|---|
| `seed_new_user()` INSERT into `user_preferences` does NOT list `length_unit` (so the default fires) | **yes** | `supabase/migrations/0004_exercise_muscles_array.sql:50-51` — literally `insert into public.user_preferences (user_id, weight_unit) values (new.id, 'kg')`. After ALTER adds `length_unit text NOT NULL DEFAULT 'cm'`, the INSERT continues to omit the column and PG fills `'cm'`. Path A is sound. |
| `CREATE UNIQUE INDEX ... ON table (col, expression) WHERE predicate` valid Postgres 14+ | **yes** | Standard since PG 7.x (expression indexes) + 7.x (partial indexes). Supabase runs PG 15+. Combining `(col, expression)` with `WHERE predicate` is well-established. |
| `date(measured_at AT TIME ZONE 'UTC')` is a valid IMMUTABLE index expression | **yes** | `timezone(text, timestamptz)` is marked IMMUTABLE in `pg_proc` when the text arg is a constant timezone literal (not session-dependent). `date(timestamp)` is IMMUTABLE. Composition is IMMUTABLE → index allowed. |
| UTC-vs-local-tz choice for the unique key | acceptable | Owner is single-user BRT (UTC-3). Local midnight = UTC 03:00 same day → UTC date matches BRT date for typical logging hours. Edge case (BRT 21:00+ logging on consecutive evenings) is explicitly documented in §Riscos (design-v2:540) and §Open questions §1 (design-v2:615). Documented escape hatch: one-line index recreate with `'America/Sao_Paulo'`. |
| Postgres `23505` = unique_violation | **yes** | Standard SQLSTATE. |
| supabase-js error shape exposes `code` reliably | **yes** | `PostgrestError` from `@supabase/supabase-js` v2.x has `code: string`, `message: string`, `details: string \| null`, `hint: string \| null`. Detecting `error.code === '23505'` is reliable. Will be a NEW pattern in the codebase (verified `error.code` is not currently used anywhere in `src/api/*`) — but that doesn't make it wrong, just first-of-its-kind. |
| `src/utils/measurements-form.ts` pattern consistent with existing forms | **yes** | `app/(app)/routines/new.tsx:12-15`, `app/(app)/exercises/new.tsx:14-21` both use string-shaped zod schemas + transform on submit. zodResolver(stringSchema) is the established pattern. The added `buildSubmitPayload` helper and `setError(path, { message })` flow is standard RHF + zod. Confidence HIGH. |
| Section headers (NativeWind classes) match profile pattern | **partial** | `app/(app)/profile.tsx:26-27` reads `<Text className="mb-2 text-sm font-medium uppercase text-gray-500">` — design-v2:432 adds `mt-4` prefix. The difference is one Tailwind class; cosmetic. Flagged as MIN-2026.05-1. |
| Tab insertion line numbers in `app/(app)/_layout.tsx` | **off by 1** | Actual lines: 32 = `tabBarIcon` line, 33 = `}}`, 34 = `/>` (closing `<Tabs.Screen>` of history), 35 = `<Tabs.Screen` (opening profile). Design says "between line 33 (closing `</Tabs.Screen>`-equivalent of history) and line 35 (opening `<Tabs.Screen` of profile)" — line 33 is actually `}}`, not the closing `/>`. The closing `/>` is line 34. Implementer's correct insertion point is between line 34 and line 35. Flagged as MIN-2026.05-2; intent is unambiguous. |
| Drizzle source dropped `DESC` claim everywhere | **yes** | Three locations all consistent: §Drizzle table snippet comment (design-v2:91-92), §DB columns indexes (design-v2:374), §Riscos (design-v2:539). No `DESC` anywhere except as documentation of how PG scans the ASC index. |

## New v2 issues

### Blockers
(none)

### Majors
(none — v2 resolves both v1 majors cleanly)

### Minors

- **[MIN-2026.05-1]** `design-v2.md:432`: §Screen 2 section header className is `mt-4 mb-2 text-sm font-medium uppercase text-gray-500`. The existing precedent at `app/(app)/profile.tsx:26-27,74-75` uses bare `mb-2 text-sm font-medium uppercase text-gray-500` (no `mt-4`). The first section in the form (Date) is also flagged "no header — first section flush at top", but headers 2-6 will have `mt-4`. Functionally fine and arguably an improvement (gives visual breathing room between sections), but it diverges from precedent without note. **Fix**: either explicitly call this out as an intentional refinement of the profile pattern, or drop `mt-4` to match.

- **[MIN-2026.05-2]** `design-v2.md:23, 49, 493-507`: Tab insertion citation says "between line 33 (closing `</Tabs.Screen>`-equivalent of history) and line 35 (opening `<Tabs.Screen` of profile)". Verified against `app/(app)/_layout.tsx:32-35` — line 33 is `}}` (closing `options` object), line 34 is `/>` (closing `<Tabs.Screen>` of history), line 35 is `<Tabs.Screen` (opening profile). The intent is correct and unambiguous; the precise anchor for the closing `/>` is line 34, not 33. **Fix**: Implementer can ignore the off-by-one and just look for the `history` block followed by `profile` block — no risk of mis-placement.

- **[MIN-2026.05-3]** `design-v2.md:459`: Edit screen says "converts canonical kg/cm/% strings back into display strings using `formatWeight`/`formatLength`/`pct.toFixed(1)`" but does not name the adapter function. The form values shape is `MeasurementFormValues` (all strings), the API returns `MeasurementEntryRow` (snake_case, numerics as `string | null`). The adapter is implicit. **Fix**: add a `rowToFormValues(row: MeasurementEntryRow, weightUnit, lengthUnit): MeasurementFormValues` helper to `src/utils/measurements-form.ts` so `[id].tsx`'s `reset(rowToFormValues(data, ...))` is one line. Cosmetic — Implementer will infer this from precedent but explicit is better.

- **[MIN-2026.05-4]** `design-v2.md:451-453, 540`: Duplicate-date banner CTA "Open existing entry" calls `router.replace("/(app)/measurements/[id]", { id: existingId })` where "existingId is found by reading the `useMeasurements()` query cache and selecting the row whose `date(measured_at)` matches." Edge case: cache may be stale if the duplicate was inserted on another device or in another window. In that case the lookup returns `undefined` and the CTA silently fails (no row to navigate to). **Fix**: when the lookup returns no row, fall back to `await refetch()` first; if still empty, show a toast/inline message ("Couldn't find the existing entry — pull to refresh."). Low impact for single-user single-device but defensive.

- **[MIN-2026.05-5]** `design-v2.md:165`: `DuplicateMeasurementDateError` is thrown when `error.code === '23505'` AND the error references `measurement_entries_user_day_idx`. The constraint-name match is fragile — Supabase error.details/message format isn't a public API. Suggest verifying the constraint name appears in `error.message` (defensive `.includes(...)`) but also fall through to throwing the raw error if the constraint name is missing, so we don't swallow unrelated unique violations (e.g. a future column gains a UNIQUE constraint). The design says "(extracted from the input — not the error message, which is fragile)" — good for the DATE extraction, but the CONSTRAINT-name check itself is the same fragility. **Fix**: design's pattern is fine in practice (there's only one UNIQUE index on this table), but add a comment in `src/api/measurements.ts` noting that adding another UNIQUE constraint to `measurement_entries` requires updating the error-discrimination logic.

- **[MIN-2026.05-6]** `design-v2.md:279`: `parse(values.measuredAt, "yyyy-MM-dd", new Date()).toISOString()` — the resulting `Date` is at local midnight, which serializes to UTC. For BRT (UTC-3), local midnight = UTC 03:00 same day, so the UTC date matches the local date and the UNIQUE index buckets correctly. For users east of UTC (e.g., UTC+9), local midnight = previous-UTC-day 15:00 — the index would bucket as the previous UTC day, off by one from what the user picked. Single-user BRT scope makes this a non-issue **today**, but worth recording so a future "multi-user" or "owner travels to Asia" scenario doesn't silently break. Design already documents the BRT-21:00 edge case (§Riscos design-v2:540, §Open questions design-v2:615) but doesn't cover the date-picker variant. **Fix**: add a one-liner to §Riscos noting that the `parse → toISOString` flow uses local midnight; for BRT this aligns with UTC bucket, but a user in UTC+N≥4 would experience off-by-one bucketing. Out of scope to fix; flag as known limitation.

## Decision

**go**

Reasoning:
- 0 blockers, 0 majors, 6 minors → satisfies the decision rule.
- Both v1 majors (`MAJ-1` seed regression, `MAJ-2` duplicate same-day) are fully resolved with sound technical choices (Path A relies on column default semantics; Path 1 uses UNIQUE partial expression index + typed error + UI banner).
- All 7 v1 minors are addressed; two have cosmetic precision issues (MIN-2026.05-1 className extra `mt-4`, MIN-2026.05-2 off-by-one line number) that the Implementer will not actually be confused by.
- Four new minors (MIN-2026.05-3 through MIN-2026.05-6) are polish items: adapter naming, stale-cache fallback for the duplicate-banner CTA, constraint-name match fragility comment, off-by-one timezone bucket for users east of UTC. None block implementation; all are defensive-coding suggestions the Implementer can address in passing.

Recommended next step: **invoke Implementer**. The Implementer should pick up the six minors as opportunistic polish but they are not gating.
