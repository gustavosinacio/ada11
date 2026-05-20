# Validation v3 — 2026-05-20_0410_strong-workout-routines-unify

Reviewing: `design-v3.md`

## Issues raised in previous validation (v2)

| ID | Severity | Addressed in v3? | Evidence |
|---|---|---|---|
| MAJ-NEW-1 | major | **yes** | Contratos `Active-session guard` early-return at lines 70-72; UI spec render-branch lines 227-229; Mudanças for `workout/index.tsx` item (3); Riscos `Data integrity` two-layer mitigation. |
| MAJ-NEW-2 | major | **yes (intent; stray import — see MIN-NEW-5)** | Verbatim `_layout.tsx` snippet JSX preserves titles "Measurements" + icons `Wrench`/`History`. Decision row 6 + Alternativas #10 pin rename as out of scope. Explicit non-changes callout at line 185. |
| MIN-NEW-1 | minor | yes | `routines/index.tsx` body uses `export default function RoutinesRedirect()`. |
| MIN-NEW-2 | minor | yes | `import { ChevronRight, Pencil } from "lucide-react-native"` explicit. |
| MIN-NEW-3 | minor | yes | `useColorScheme` imported + called in workout home, citing `routines/index.tsx:3,10`. |
| MIN-NEW-4 | minor | yes (deferred) | Pinned in Riscos and Out of scope. |

## v3-new claims

| Claim | Verified? | Evidence |
|---|---|---|
| `if (active.isLoading) return <ActivityIndicator/>;` early-return present | yes | design-v3.md:70-72, 227-229, 437. Matches `workout/index.tsx:53-58` precedent. |
| Redirect file named `RoutinesRedirect` | yes | design-v3.md:374. |
| Snippet does NOT contain "Body" | yes | "Body" only at lines 416, 421 (Alternativas/Out of scope). |
| Snippet does NOT contain `Library` | yes | nowhere in v3. |
| Snippet JSX does NOT use `Clock` | yes | line 162 uses `<History>`. |
| Snippet imports do NOT contain `Clock` | **no** | design-v3.md:125 imports `Clock` "unchanged — used by History tab". Current `_layout.tsx:2-9` does NOT import `Clock`, and snippet JSX uses `History`. See MIN-NEW-5. |
| Two-line `Redirect` valid | yes | `app/index.tsx` precedent. |
| `e.stopPropagation?.()` cross-platform | yes | Optional chaining no-ops on native. |
| Test file paths + line numbers correct | yes | all 4 sites verified. |

## Issues found

### Blockers
None.

### Majors
None.

### Minors

- **[MIN-NEW-5]** `_layout.tsx` snippet imports `Clock` from `lucide-react-native` with comment "unchanged — used by History tab". Two errors: (a) current `_layout.tsx` does NOT import `Clock`, so "unchanged" is wrong; (b) `Clock` is not used in the snippet's JSX (which uses `History`). Contradicts MAJ-NEW-2 callout at line 185. **Fix**: drop the `Clock` import line from the snippet. Implementer note.

- **[MIN-NEW-6]** Design Decision row 9 justifies naming the redirect via "avoids `import/no-anonymous-default-export` lint warning" — that rule isn't configured in this repo's ESLint. Naming is still good practice (stack traces, React DevTools), so the change is harmless. Cosmetic premise correction only.

## Decision

**go**

Reasoning:
- 0 blockers, 0 majors, 2 minors → `go`.
- Both v2 majors fully addressed.
- Implementer should drop the stray `Clock` import (MIN-NEW-5) when applying the verbatim snippet.

## Counts
- Blockers: 0
- Majors: 0
- Minors: 2
