# Discovery — 2026-05-22_1530_date-format-unification

## Feature prompt

> All dates can be shown as only the month and day, but if the date belongs to a previous year, the year needs to be included in the date. This is noticeable especially on the history and progress screens.

## Scope summary

Unify the year-conditional date-display rule already shipped for the History session-list row (`session-summary-row.tsx:15-31`, F5 batch) across every other human-facing date surface in the app. Concretely: when a date is in the current local year, render month + day only; when it's in a prior year, append the year. Strong precedents already exist with a working shape (`Sat, May 24` / `Fri, Nov 8, 2019`) — the work is (a) deciding whether to keep or drop the weekday prefix, (b) centralising the formatter, (c) propagating it to every surface that currently hard-codes year or hard-omits it.

## Affected files (verified)

### Surfaces that render a human-facing date (must be touched)

- `src/components/session-summary-row.tsx:15-31` — History session-list rows. **Already year-aware**: `Intl.DateTimeFormat` opts `{ weekday: "short", month: "short", day: "numeric" }`, conditionally adds `year: "numeric"` if `d.getFullYear() !== new Date().getFullYear()`. Renders `Fri, Nov 8, 2019` / `Sat, May 24`. This is the F5 precedent.

- `src/components/measurement-list-item.tsx:48-52` — Measurements list row date label. **Hard-codes year always**: `format(parseISO(entry.measured_at), "EEE, MMM d, yyyy")` → `Fri, May 22, 2026`. Out of compliance with the new rule.

- `app/(app)/measurements/[id]/index.tsx:72-77` — Measurement detail screen headline. **Hard-codes year always**: same `"EEE, MMM d, yyyy"` formatter, renders as a 2xl bold headline at the top.

- `app/(app)/history/week/[isoWeek].tsx:101` — Week drill-down screen title. **Never includes year**: `format(monday, "MMM d")` → `Week of May 18`. Ambiguous for old weeks.

- `app/(app)/history/week/[isoWeek].tsx:140-145` — Week drill-down body range. **Never includes year**: `${format(monday, "MMM d")} – ${format(new Date(sundayMs), "MMM d")}` → `May 18 – May 24`. Same ambiguity.

- `src/components/weekly-volume-strip.tsx:56-63` — Visible-range pill ("Apr 27 – Jun 21, 2026" / "Dec 29, 2025 – Jan 11, 2026"). **Already year-aware at boundary level**: single-year window appends year only on the end label; cross-year window appends year on both. Different rule from the F5 precedent — applies year to "current" range too, not just "previous-year" range.

- `src/components/weekly-volume-strip.tsx:279-283` — Per-bar accessibility label only. **Already year-aware**: `"View week of {label}"` (M/d, no year) when current year; `"View week of M/d/yyyy"` otherwise. Not user-visible text per se, but a screen-reader value following the same rule.

- `app/(app)/exercises/[id]/progress.tsx:21-28` + `app/(app)/exercises/[id]/progress.tsx:69` — Exercise progress chart x-axis labels. **Never includes year**: `shortDate()` returns `M/D` (e.g. `5/22`) built from `d.getMonth()+1 + "/" + d.getDate()`. Will lie when chart includes sessions from a previous year — `5/22` could be 2024 or 2026.

- `src/utils/measurements-chart.ts:7-14` — Bodyweight chart x-axis labels (Measurements list strip). **Never includes year**: identical `shortDate()` clone (`M/D`). Same ambiguity for users with >1 year of bodyweight history.

- `src/utils/dates.ts:65, 83, 114` (and consumers in `weekly-volume-strip-math.ts` via `IsoWeek.label`) — ISO-week Monday bucket labels. **Never includes year**: `format(start, "M/d")`. Used as the small text under each bar in `<WeeklyVolumeStrip>` (`weekly-volume-strip.tsx:298`). Same ambiguity for users whose first session is >1 year ago.

- `src/utils/progress-page-math.ts:99-117` — "Best week ever" label reconstructed from an ISO-week key. **Never includes year**: returns `M/d`. Surfaces in `progress/index.tsx:36` as `Best week: 26,210 kg (5/13)`. **Critically wrong** for users whose lifetime best week is from a previous year — `(5/13)` reads as this year.

- `src/components/session-times-editor.tsx:113-132` + `src/utils/format-session-times.ts:8-20` — History session detail "started at" line. **`formatDateTime` never includes year**: `toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })` → `Mon, May 18, 4:30 PM`. Drops year for sessions logged in prior years.

### Surfaces with raw timestamp strings (date helpers; not display, but use date helpers)

- `src/utils/session-times-form.ts:79-86` (`decomposeIso`) — `YYYY-MM-DD` for form inputs. NOT display-facing (text input value). Out of scope.

- `src/utils/measurements-form.ts:33-35` (`formatDateInput`) — `yyyy-MM-dd` for form input default value. Out of scope.

- `src/utils/dates.ts:46-49, 64, 82, 113` (`weekKeyOf`) — `RRRR-Www` opaque key (used in Map keys + URL segments). Out of scope.

- `src/components/weekly-volume-strip.tsx:279` (`yyyy-MM-dd` URL segment for week drill-down). Out of scope.

### Pure-data helpers / no date strings rendered

- `src/components/streak-card.tsx` — only renders week counts, no date strings.
- `src/components/progress-hero.tsx` — only renders counts + volume, no dates.
- `src/components/exercises-this-week-list.tsx` — no dates.
- `src/components/pr-list-row.tsx`, `src/components/volume-target-slot.tsx`, `src/components/exercise-block.tsx` — no dates.
- `src/components/active-session-banner.tsx`, `src/components/session-header.tsx` — no calendar dates (live elapsed timer only).

## Relevant conventions (verified by reading code)

- **Display formatting is per-file local.** No central `formatDisplayDate` exists today. Each of the 8 distinct date-render sites listed above implements its own formatter, with three different idioms:
  1. `Intl.DateTimeFormat` via `Date#toLocaleDateString` / `toLocaleString` (`session-summary-row.tsx`, `format-session-times.ts`).
  2. `date-fns/format` with explicit token strings (`measurement-list-item.tsx`, `app/(app)/measurements/[id]/index.tsx`, `weekly-volume-strip.tsx`, `dates.ts`, `progress-page-math.ts`, `app/(app)/history/week/[isoWeek].tsx`).
  3. Manual `Date#getMonth()/getDate()` concatenation (`exercises/[id]/progress.tsx:shortDate`, `measurements-chart.ts:shortDate`).

  The two `shortDate` implementations are **near-duplicates** of each other (one comment in `measurements-chart.ts:26-27` explicitly notes the duplication). Strong candidate for centralisation.

- **Year-suffix rule already established (F5 batch).** `session-summary-row.tsx:24-26` uses the precise rule the user is now asking for app-wide: compare `d.getFullYear()` against `new Date().getFullYear()`, both in device-local time. Single source of authoritative behaviour.

- **Locale handling**: `session-summary-row.tsx` and `format-session-times.ts` pass `undefined` as the locale arg → device locale. `date-fns/format` uses month/weekday names from the en-US locale baked into `date-fns` (no `i18n` plumbing in this project). Both produce "May" / "Nov" / "Mon" / "Fri" — visually compatible but produced by different libs.

- **Weekday prefix is currently NOT universal.** Three sites include it (`session-summary-row.tsx`, `measurement-list-item.tsx`, `app/(app)/measurements/[id]/index.tsx`, `format-session-times.ts`); the rest (chart axes, week titles, range pill, best-week label, history week range) all omit it. The user's "only the month and day" wording is ambiguous — it could mean (a) "drop weekday everywhere" or (b) "the format I'm thinking of is the existing month+day one; just add year-when-needed".

## Constraints

- **Data**: No schema change. All sources are existing ISO 8601 columns (`sessions.started_at`, `sessions.ended_at`, `sets.completed_at`, `measurement_entries.measured_at`). Source-of-truth is UTC; display is local-time per F5 precedent (`new Date(iso)` then local-time getters).

- **UI**: NativeWind. Surfaces span list rows (small body text), screen titles (2xl), chart axes (9-10pt SVG text), and a pill (xs). No styling change implied — text content only.

- **Platform**: All surfaces are RN universal (iOS/Android/web). `Intl.DateTimeFormat` is supported on all three; `date-fns/format` is bundled with the app. No platform-specific divergence.

- **Auth**: No auth-context impact — purely formatting.

- **Performance**: Hot paths: `<SessionSummaryRow>` rendered N times in the History list (FlatList), `<MeasurementListItem>` N times in the Measurements list, chart-axis labels rendered once per chart (≤12 points). A central helper using `Intl.DateTimeFormat` constructed per call is fine — that's the existing F5 cost profile. If we wanted to micro-optimise, we'd memoise the `current year` reference; not gating.

- **Locale**: Device locale (`undefined`) for `Intl`; `date-fns` defaults to en-US. Mixing the two means a Brazilian-Portuguese device would see "May" from `date-fns/format` but potentially "mai." from `Intl.DateTimeFormat` for adjacent dates. The F5 precedent uses `Intl` with `undefined` locale → device-local month name. If we centralise, picking ONE idiom resolves the inconsistency.

## Existing precedents

- **F5 batch year-suffix (current authoritative example)**: `session-summary-row.tsx:15-31`. This is the user's likely target shape: keep current format, append year for prior-year dates only.

- **Cross-year aware range formatter**: `weekly-volume-strip.tsx:56-63` (`formatVisibleRange`). Uses a different rule than F5: it appends year on the END label for single-year windows AND on both labels for cross-year windows. Note this is not the same rule the user is asking for (it adds year to current-year ranges too). May need its own treatment — the visible-range pill is informational scrolling context, not a date the user is reading to know "when did this happen".

- **Numeric chart axes**: `exercises/[id]/progress.tsx:shortDate` + `measurements-chart.ts:shortDate`. These are SVG x-axis tick labels — different display constraint (must fit in a small numeric range). Centralised helper should offer a "short" variant (M/D, no weekday, year-when-needed) distinct from the "long" variant (Sat, May 24, no year / Fri, Nov 8, 2019).

- **Year-aware accessibility label**: `weekly-volume-strip.tsx:281-283`. Uses M/d for current year, M/d/yyyy for prior year. Same shape as the proposed chart-axis helper would produce.

## Unknowns (require Designer judgment or human decision)

1. **Keep or drop weekday prefix?** The user's "only the month and day" wording is ambiguous given F5 shipped with a weekday (`Sat, May 24`). Two readings, illustrated with the 5 most prominent surfaces:

   | Surface | Keep-weekday (matches F5 precedent) | Drop-weekday (matches literal user prompt) |
   |---|---|---|
   | History session-list row | `Sat, May 24` / `Fri, Nov 8, 2019` | `May 24` / `Nov 8, 2019` |
   | History session detail "started at" | `Mon, May 18, 4:30 PM` / `Mon, Nov 4, 2019, 4:30 PM` | `May 18, 4:30 PM` / `Nov 4, 2019, 4:30 PM` |
   | Measurements list row | `Fri, May 22, 2026` (today, hard-coded year) → `Fri, May 22` / `Fri, Nov 8, 2019` | `May 22` / `Nov 8, 2019` |
   | Measurement detail headline | (same as above, 2xl bold) | (same as above, 2xl bold) |
   | History week title | (no weekday available — week range) `May 18 – May 24` / `Nov 4 – Nov 10, 2019` | (same — week ranges have no single weekday) |

   Recommendation for Designer: **drop weekday** for new surfaces is consistent with the user's literal words AND simpler; **keep weekday on session/measurement rows** because they encode "what day-of-week did I train" — a weekly-rhythm cue worth preserving. The Designer should pick and document. If the choice is drop-weekday, the F5 ship (`session-summary-row.tsx`) needs updating as part of this run.

2. **Best-week label format**. `progress-page-math.ts:weekKeyToMondayLabel` returns `"M/d"`. Inserted as `Best week: 26,210 kg (5/13)`. Should this become `Best week: ... (May 13)` for consistency, or stay `M/d` for compactness? Mostly cosmetic but worth a Designer call.

3. **Visible-range pill semantics**. The pill currently renders year on the end of single-year windows too (`Apr 27 – Jun 21, 2026`). Does the new rule mean "don't append year for current-year windows"? That would change the pill in the common case. Designer call: keep the pill's stricter rule (always show year on end of range) for "this is what range you're looking at" context, or align to the F5 rule (year only for cross-year)?

4. **`format-session-times.ts:formatDateTime` consumers**. Only consumed by `<SessionTimesEditor>` today. Verify no other future caller that would be surprised by adding conditional year. (Verified: grep shows only the editor imports it.)

5. **Centralised helper location and signature**. Two reasonable shapes:
   - `src/utils/format-display-date.ts` → exports `formatDisplayDate(iso, { weekday?: boolean, time?: boolean, range?: { startIso, endIso } })`. One place to read.
   - `src/utils/dates.ts` → add the helpers next to ISO-week math (already collocated with `parseISO` re-export).

   Designer call. The first has the advantage of being grep-able by intent; the second avoids a new file.

6. **Locale mixing**. Switching every formatter to `Intl.DateTimeFormat` (device locale) would change month names on non-English devices. Switching every formatter to `date-fns/format` would lock month names to en-US. The current mix is accidental. Designer should pick one and document.

7. **e2e regression on the visible-range pill**. `tests/e2e/week-drill-down.spec.ts:233-240` has a tight regex anchored with `^...$` to discriminate the no-year body header from the always-year pill. If the Designer changes either rule, this anchor breaks and the test needs updating.

## Out-of-scope flags

- **Input formatters**: `decomposeIso`, `formatDateInput`, regex masks (`session-times-form.ts`, `measurements-form.ts`). These produce `YYYY-MM-DD` for form inputs, not display strings.

- **Opaque storage keys**: `weekKeyOf` (`RRRR-Www`), week URL segments (`yyyy-MM-dd`). Internal identifiers, not user-facing.

- **Live elapsed timer**: `<SessionHeader>` formats `mm:ss` / `h:mm:ss`, no calendar date.

- **Schema or query changes**: All surfaces consume already-fetched ISO strings. No DB or API work.

- **Localisation expansion**: This run picks a rule; it does not introduce i18n month-name translation. If the Designer chooses `date-fns` over `Intl`, that locks en-US for now, which is consistent with the rest of the project (no `i18next` / `react-intl` present).

- **"This year" / "last week" relative phrasings**: Not in scope — user asked specifically about month/day with year-when-needed, not relative phrasing.
