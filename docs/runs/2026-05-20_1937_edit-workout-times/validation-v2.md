# Validation v2 — 2026-05-20_1937_edit-workout-times

## v1 issues re-verified

| v1 ID | v2 Status | Evidence |
|---|---|---|
| BLK-1 (prop-sync effect race) | **Resolved** | `design-v2.md:259-272` — imperative initializer + `openEdit()` re-derive; no prop-sync `useEffect`. |
| BLK-2 (composeIso swallowing invalid) | **Resolved** | `design-v2.md:116-120` — `parse(\`${localDate} ${localTime}\`, "yyyy-MM-dd HH:mm", new Date())` mirrors `src/utils/measurements-form.ts:128-137`. TIME_RE tightened to `/^(2[0-3]|[01]\d):([0-5]\d)$/` — rejects `24:00, 25:99, 09:60`. |
| MAJ-1 (Save not gated on isSubmitting) | **Resolved** | `loading={props.isSubmitting}` + `disabled={props.isSubmitting}` on Cancel. (See MIN-NEW-1 for separate Button API typo.) |
| MAJ-2 (stale submitError on re-open) | **Resolved** | `design-v2.md:282-287, 384` — `onCancel` callback + parent `mutation.reset()`. |
| MAJ-3 (TZ pinning) | **Partially — see MAJ-NEW-1** | `process.env.TZ` at top of test file is not reliable in ESM Vitest. |
| MAJ-4 (UTC-vs-UTC bounds check) | **Resolved** | `design-v2.md:171-184` — `countSetsOutsideRange` uses `Date.getTime()` ms on composed UTC ISO; null-filtered. |
| MIN-1 (KEYS.active invalidation) | **Resolved** | `design-v2.md:78`. |
| MIN-2 (seconds drift) | **Resolved** | Documented at `design-v2.md:423`. |
| MIN-3 (keyboardType) | **Resolved** | Switched to `"numeric"`. |
| MIN-4 (cross-week e2e arm) | **Resolved** | Second `test()` arm asserts asymmetry. |

## Blockers
None.

## Majors

### MAJ-NEW-1 — `process.env.TZ = ...` "at top of file" is not reliable in ESM Vitest
**Location**: `design-v2.md:37, 434, 473`.

In ESM, `import` statements are statically hoisted and execute BEFORE the literal env assignment. Three correct alternatives:
- **Preferred (project precedent at `scripts/import-strong.ts:57`)**: use `date-fns-tz fromZonedTime("...", "America/Sao_Paulo")` in tests to construct expected ISO values; test becomes host-TZ-independent.
- Add `tests/unit/_setup-tz.ts` referenced via `vitest.config.ts > test.setupFiles`.
- Prefix the npm script with `TZ=America/Sao_Paulo`.

The bug surface here is narrow (`composeIso` reads local TZ only at call time, no module-init Date math), but "happens to work depending on file order" is exactly what test infra must not depend on.

**Fix**: drop the `process.env.TZ` formulation; use `date-fns-tz` in tests (preferred).

## Minors

### MIN-NEW-1 — Pseudo-code Button uses children; actual API requires `label` prop
`src/components/ui/button.tsx:6-11` types `Props = Omit<PressableProps, "children"> & { label: string; ... }`. Pseudo-code's `<Button onPress=...>Save</Button>` won't compile. Use `<Button label="Save" onPress={onSave} loading={props.isSubmitting} variant="primary" />`.

### MIN-NEW-2 — `<Pencil className="text-gray-500" />` won't pick up Tailwind colors
Existing `lucide-react-native` usage passes `color="..."` (see `routine-list-item.tsx:45`, `measurements/[id]/index.tsx:155`). NativeWind text-color utilities don't target SVG `stroke`. Use `color="#6b7280"` with `useColorScheme()` for dark variant.

### MIN-NEW-3 — `formatDateTime` / `formatDuration` reuse unspecified
Defined as private functions at `app/(app)/history/[id].tsx:33-54`. The new component references them but the design doesn't say import/extract/duplicate. Extract to `~/utils/format-session-times.ts` (single source of truth).

### MIN-NEW-4 — `useMemo` for `outsideCount` uses `Date.now() + 365d` sentinel
`design-v2.md:301-305` extends the validation cutoff by 1y to bypass `end-in-future` during draft edit. Works but unobvious. Cosmetic — could extract a `composeBoth(draft)` helper that does only format/parse checks (no cross-field). Optional cleanup.

## Decision

**go** — 0 blockers, 1 major (TZ pinning), 4 minors.

Implementer must:
- Use `date-fns-tz fromZonedTime("...", "America/Sao_Paulo")` in tests (NOT `process.env.TZ`).
- Use `<Button label="..." />` API.
- Pass `color="..."` to Pencil; not className.
- Extract `formatDateTime`/`formatDuration` to a shared util.
- Optionally clean the +1y sentinel.

Round 2 of 3. Recommend invoke Implementer.
