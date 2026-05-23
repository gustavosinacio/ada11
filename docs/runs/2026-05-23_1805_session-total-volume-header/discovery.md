# Discovery — 2026-05-23_1805_session-total-volume-header

## Feature prompt
> Show current session total volume at the top of the workout page. During a live workout, the user should see the total volume accumulated so far in this session displayed prominently at the top of the workout screen. The number should update live as sets are checked/unchecked and as weight/reps are edited.

## Scope summary
UI-only addition to the live workout screen header. A session-wide running volume number (kg or lbs based on `useWeightUnit`) is rendered at the top of `app/(app)/workout/[sessionId].tsx`, derived from the already-mounted `useSetsForSession(sessionId)` query via the canonical `sumLiveVolume` kernel from `src/utils/volume-target.ts`. No DB/API/schema/cache changes. Updates propagate automatically through the existing TanStack invalidation chain on check/uncheck/edit/log/delete.

## Affected files (verified)

### Primary touchpoints
- `app/(app)/workout/[sessionId].tsx:397-405` — Top of the live workout screen body. Currently mounts `<Stack.Screen options={{ title: "Workout", headerShown: true }} />` then `<SessionHeader startedAt={…} onFinish={onFinish} finishing={finish.isPending} />` directly above the `<ScrollView>`. This is where the new total-volume display must land (either via a new prop on `SessionHeader` or a new sibling element above the `<ScrollView>`).
- `src/components/session-header.tsx:1-50` — The two-row "Elapsed | Finish" header. Currently:
  - Left column: `<Text className="text-xs text-gray-500">Elapsed</Text>` + `<Text className="text-2xl font-semibold tabular-nums…">{formatElapsed(elapsed)}</Text>`.
  - Right column: a black/white `Finish` `<Pressable>` with `accessibilityLabel="Finish workout"`.
  - Container is `flex-row items-center justify-between border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-black`.
  - This is the smallest-blast-radius site to add the volume display — either as a new center column, a third row above/below "Elapsed", or a sibling element above the existing row.
- `app/(app)/workout/[sessionId].tsx:69` — `const setsQ = useSetsForSession(sessionId);` — the existing query that already drives the entire screen body. The new total-volume number reuses this exact cache; no new hook, no new key.

### Read-only references (no edits)
- `src/utils/volume-target.ts:88-100` — `sumLiveVolume(sets: SetRow[]): number`. Canonical live-volume kernel. Predicate per element: `completed_at != null && set_type !== "warmup" && Number.isFinite(parseFloat(weight)) && w > 0 && reps > 0`. **Includes dropsets** by construction (only warmups are skipped). Returns kg.
- `src/utils/units.ts:33-40` — `formatVolume(kg, unit)`. Rounds to nearest integer, formats with `en-US` thousands separator, suffixes `" kg"` or `" lbs"` after converting via `kgToLbs`. Used everywhere aggregate volume is shown.
- `src/hooks/use-preferences.ts:24-27` — `useWeightUnit(): WeightUnit` (`"kg" | "lbs"`, default `"kg"`).
- `src/hooks/use-sets.ts:36-42` — `useSetsForSession(sessionId)`. Query key `["sets", sessionId]`. Returns `SetRow[]` ordered `completed_at ASC nullsLast, set_number ASC`.
- `src/hooks/use-sets.ts:65-77, 88-99, 101-110, 131-149, 151-167, 169-177` — every mutation that can change a set's contribution to the running total (`useUpdateSet`, `useUpdateSetMeta` *(meta-only, no stats invalidation; safe to ignore for volume)*, `useDeleteSet`, `useCheckSet`, `useUncheckSet`, `useBulkCheckAllInSession`, `useBulkSoftDeleteUncheckedInSession`) — all invalidate `["sets", sessionId]`, so the new computed total auto-rerenders. `useLogSet` (44-53) does too.
- `app/(app)/workout/verdict/[sessionId].tsx:53-56, 139` — closest precedent for the same number. Verdict screen computes `totalVolumeKg = useMemo(() => sumLiveVolume(setsQ.data ?? []), [setsQ.data])` then `formatVolume(totalVolumeKg, unit)` and includes it in the headline `+N PRs · Y kg · Zh Wm` (line 140).

## Relevant conventions (verified by reading code)
- **F10 "checked = committed" semantics.** Established by run `2026-05-21_1308_set-check-button` and made the cross-feature invariant by `2026-05-21_2225_multi-metric-strip`. Every live, user-visible volume number that aggregates the current session counts ONLY rows with `completed_at != null` (warmups still excluded by `set_type`). Verified at `src/utils/volume-target.ts:88-100` (`sumLiveVolume`), `src/utils/session-verdict-math.ts:33-48` (verdict per-exercise breakdown), and `src/components/volume-target-slot.tsx:60-65` ("Now" copy on the per-exercise strip). The new session header total MUST follow the same rule — diverging would re-introduce the exact "Volume to PR looks wrong" perception bug that the multi-metric-strip run was created to fix (cited at `docs/runs/2026-05-21_2225_multi-metric-strip/design-v1.md:13-14`).
- **`formatVolume` is the only aggregate formatter.** Always pass kg; the helper handles `lbs` conversion and locale-fixed `en-US` thousands separator (`src/utils/units.ts:33-40`). Per-set displays use `formatWeight` instead; mixing the two creates "26.210 kg" pt-BR rendering bugs that motivated the en-US lock.
- **Numerals on dark+light = `tabular-nums` + `font-semibold text-black dark:text-white`.** Mirrored by `session-header.tsx:33-34`, `volume-target-slot.tsx:95-105`, `workout/verdict/[sessionId].tsx:163`, and the rest-timer overlay (`rest-timer-overlay.tsx:58-59`). The new total-volume number should use the same NativeWind classes for visual coherence.
- **Live-screen sticky elements use absolute positioning at `bottom-0`** (`rest-timer-overlay.tsx:21, 49`). The top-of-screen `SessionHeader` is in normal flow (not absolute). The `<ActiveSessionBanner>` lives at the global tab-layout level (`app/(app)/_layout.tsx:16`) — NOT mounted on the live screen (the live screen IS the active session, so the banner self-hides via `if (!active.data) return null`).
- **No new query keys for derived data.** The `useSetsForSession` cache is the single source of truth; deriving via `useMemo` is the established pattern (verdict screen, volume-target slot, weekly volume strip math kernel all follow this).

## Constraints
- **Data**: No DB, RLS, schema, or migration touch. Read-only consumer of the existing `sets` table via `listSetsForSession`. No cache buster bump needed (Decision 9 only applies to schema-affecting changes — `src/lib/query-client.ts` does NOT need to change).
- **UI**: NativeWind v4. The header lives in normal flow above a `<ScrollView>`; scrolling does not affect its visibility. No native-modal / portal trickery required. Numerals must use `tabular-nums` so they don't dance as digits change width during live edits.
- **Platform**: iOS / Android / web universal. `formatVolume` already uses an explicit en-US locale to avoid the pt-BR thousands-separator collision (see JSDoc at `src/utils/units.ts:26-32`). `text-2xl` may need to drop to `text-xl` if the volume number + Elapsed + Finish trio overflows in landscape on small phones — Designer call.
- **Auth**: Inherits from `useSetsForSession` (RLS by `auth.uid() = user_id` on `sets`). Live screen already authed; no new auth surface.
- **Performance**: One `useMemo([setsQ.data])` reduce over the session's set rows on every cache update. Typical session has <100 sets — negligible. The reduce is the same shape as the verdict screen already runs without instrumentation needed.

## Existing precedents
- **`app/(app)/workout/verdict/[sessionId].tsx:53-56, 139-140`** — the gold-standard precedent. Same number (`sumLiveVolume(setsQ.data ?? [])`), same formatter (`formatVolume(totalVolumeKg, unit)`), same NativeWind treatment. The verdict screen prints it post-finish; this feature prints it during the live session. They must agree on every digit at the moment of Finish — by reusing `sumLiveVolume` we get that for free (`2026-05-22_0152_end-of-session-verdict/discovery.md:133`).
- **`src/components/volume-target-slot.tsx:60-117`** — per-exercise live "Now" copy. Already follows the F10 rule via `sumLiveVolume` called from inside `computeVolumeTarget`. The session-wide total = `sumLiveVolume(allSetsInSession)` is mathematically the sum of all per-exercise "Now" numbers (modulo exercises with no PR baseline that hide their slot — but the kernel is identical).
- **`src/components/weekly-volume-strip.tsx:21, 249`** — `formatVolume(model.currentWeekKg, unit)` over a `text-2xl font-semibold tabular-nums…` numeral. Same numeral treatment we want for the header.
- **`src/components/session-header.tsx:30-48`** — the file we'll likely modify. Two-column flex-row is the established header shape; the natural extension is a centered third column or a label-above-number block on the left next to "Elapsed".
- **`docs/runs/2026-05-21_2225_multi-metric-strip/`** — the most relevant prior run. It added a *per-exercise* "Now" running-volume to the live screen with the exact F10 inclusion rule we need. Read its design-v1.md before designing this one; the inclusion-rule debate is settled there.

## Unknowns (require Designer judgment or human decision)
1. **Inclusion rule for dropsets and warmups** *(assumption flagged for confirmation)*. `sumLiveVolume` includes dropsets and excludes warmups. The prompt says "total volume accumulated so far in this session"; the canonical kernel says working + dropset, checked only. **Assumption**: reuse `sumLiveVolume` verbatim (warmups out, dropsets in, unchecked drafts out). This matches every other live-volume surface (verdict, per-exercise "Now"). The Designer should confirm or override; if the override is "include unchecked drafts" or "exclude dropsets", that's a NEW kernel and should be flagged because it diverges from F10. **Recommendation: reuse `sumLiveVolume`.**
2. **Empty state** when no sets are checked yet. Options: (a) render `0 kg` (matches verdict screen's zero-volume case at `workout/verdict/[sessionId].tsx:139`, which shows `0 kg` in the headline; matches the volume-target slot's "Now 0 kg" before any check), (b) hide the number entirely until first check, (c) show a placeholder like "—". The verdict precedent strongly suggests (a) `0 kg`. The per-exercise "Now" strip at `volume-target-slot.tsx:74-79` ALSO renders `0 kg` (it hides only the optional "≈ reps @ Wkg" clause when `runningKg === 0`, not the Now itself).
3. **Display label and format**. Options: (a) `Volume\n12,345 kg` (label-above-number block, mirrors the `Elapsed\n12:34` left column at `session-header.tsx:31-35`), (b) inline `Volume · 12,345 kg`, (c) just `12,345 kg`. Visual symmetry with the existing "Elapsed" block argues strongly for (a). Designer call.
4. **Placement inside the header**. Three viable slots: (i) new column inside `<SessionHeader>` between Elapsed and Finish (flex-row stretches), (ii) new second row inside the header container below the Elapsed/Finish row (vertical stack), (iii) sibling element above or below `<SessionHeader>`, in normal flow. Option (i) keeps the header to one row but tightens horizontal space — risk on small phones. Option (ii) gives the number its own row but doubles header height. Option (iii) is the cleanest separation but breaks the visual unit. Designer call; pin a screenshot dimension constraint (iPhone SE 320 logical px) before committing.
5. **Visibility during error / loading states**. The screen has guards at `app/(app)/workout/[sessionId].tsx:375-395` for `session.isLoading` and `session.isError` that return early to a centered `ActivityIndicator` / error text. `setsQ.data` may also be `undefined` on first render. `sumLiveVolume(undefined ?? [])` returns `0`, but the Designer should decide: render `0 kg` during sets-loading, or render a skeleton, or hide. The verdict screen renders nothing while `!isHeadlineReady` (line 122-131) — but that screen is one-shot, while this header lives for the duration of the session and the value must update live. **Assumption**: render `0 kg` while loading (matches the verdict's terminal behavior and avoids layout jank).
6. **Cancel-session affordance interplay**. The cancel button is NOT in the header — it's at `app/(app)/workout/[sessionId].tsx:531-541`, rendered inside the `<ScrollView>` below all exercise blocks, in a red `mt-2 bg-red-50` `<Pressable>` (or `dark:bg-red-950/30`). The header only carries Elapsed + Finish today. Adding a volume display to the header does NOT crowd Cancel because they're in different layout regions. Risk = NONE on Cancel placement, but the Designer should still confirm header doesn't visually compete with the prominent black Finish button.
7. **Does the same display belong on the verdict screen / post-finish?** The verdict screen already renders the same number in its headline (`workout/verdict/[sessionId].tsx:140`). The live session header proposed here is for ACTIVE sessions only (the `[sessionId].tsx` route is the live screen; finished sessions surface via `/history/[id]`, a different file). The prompt scopes to "live workout" — out of scope for History detail and verdict. **Recommendation: scope to the live screen only.**
8. **Accessibility label format**. The verdict screen uses `accessibilityLabel={\`${prCountLabel}, ${volumeLabel}, ${durationLabel}\`}` on the headline (line 164). A reasonable analog here: `accessibilityLabel={\`Session volume \${volumeLabel}\`}` on the number block, with role `text`. Designer should specify the exact label.

## Out-of-scope flags
- **No new database column, migration, RLS policy, or cache buster bump.** This is a pure UI consumer of an existing query.
- **No change to `sumLiveVolume`, `formatVolume`, `computeVolumeTarget`, or any kernel in `src/utils/`.** Reuse verbatim. If the Designer wants a different inclusion rule (e.g. include drafts), surface that as a redesign, NOT by forking the kernel.
- **No change to history detail screens** (`app/(app)/history/[id].tsx`, etc). Prompt is explicit: "during a live workout".
- **No change to the verdict screen.** It already shows total volume; no harmonization work required (and the numbers will match by construction because both consume `sumLiveVolume` over the same query).
- **No header on the workout home screen** (`app/(app)/workout/index.tsx`) — it's a list of routines, not a live session, and `useSetsForSession` would be undefined-keyed.
- **No revision of the Cancel-workout button position or styling.**
- **No new tests inventing a different volume rule.** Any new unit test should pin against `sumLiveVolume` as the source of truth; any e2e should assert the rendered string matches `formatVolume(sumLiveVolume(setsForSession), unit)`.

## Locked-in test surface (must not break)
These existing e2e selectors are load-bearing for the live workout screen header; the new feature must not displace them. None assert the *absence* of a volume display, so adding one is non-breaking by construction — but the new element MUST NOT shadow the strings these selectors look for.
- `tests/e2e/crud.spec.ts:180-181` — `getByText("Elapsed", { exact: true })` visible; `getByText("Finish", { exact: true }).last()` visible.
- `tests/e2e/rest-timer-auto-start.spec.ts:196, 621` — `getByText("Elapsed", { exact: true })` visible (wait gate for "live workout mounted").
- `tests/e2e/end-of-session-verdict.spec.ts:229, 298` — same "Elapsed" wait gate.
- `tests/e2e/remove-exercise.spec.ts:107` — same.
- `tests/e2e/soft-deleted-exercises-in-history.spec.ts:128` — same.

These all rely on the literal string `"Elapsed"` being uniquely findable. The new header element should NOT introduce a second `"Elapsed"` string or break the existing one's `exact: true` match.

## Pipeline context links
- F10 set-check semantics: `docs/runs/2026-05-21_1308_set-check-button/` (final-summary.md). Defines `completed_at = null ⇔ unchecked draft`.
- Multi-metric strip (closest cousin): `docs/runs/2026-05-21_2225_multi-metric-strip/` (design-v1.md, discovery.md). Settled the "checked-only `runningKg`" debate.
- End-of-session verdict (sister screen, same number): `docs/runs/2026-05-22_0152_end-of-session-verdict/` (design-v2.md). Established `sumLiveVolume` as the cross-screen single source of truth.
- Configurable max-volume window (recent, unrelated): `docs/runs/2026-05-23_0211_configurable-max-volume-window/`. Touches PR detection windows; does NOT affect the un-windowed session total proposed here.
