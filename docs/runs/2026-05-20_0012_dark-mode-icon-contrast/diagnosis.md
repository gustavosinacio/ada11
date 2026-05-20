# Diagnosis — 2026-05-20_0012_dark-mode-icon-contrast

## Hypothesis
Lucide React Native icons accept a `color` prop and do **not** read NativeWind className. When the icon's color is hardcoded to a value that matches one of the theme backgrounds (e.g. `#000` on dark mode, `#fff` on a `dark:bg-white` button), the icon becomes invisible.

The project's theme adaptation pattern (`text-black dark:text-white`, `bg-black dark:bg-white`) applies via className → does not propagate to icon `color` props.

## Evidence

### Source of truth files
- `app/(app)/exercises/index.tsx:22-26` — header right `<Plus color="#000" size={22} />` inside a `<Pressable>` over the screen background. Screen container is `bg-white dark:bg-black`. In dark mode, the icon is black on near-black → invisible.
- `app/(app)/routines/index.tsx:22-26` — same pattern, same bug.
- `app/(app)/routines/[id]/index.tsx:184-194` — `<Plus color="#fff" size={16} />` inside `<Pressable className="bg-black px-3 py-2 dark:bg-white">`. In dark mode the button background flips to white; the icon stays white → invisible.

### Other hardcoded icon colors (not blockers)
| File:Line | Icon | Color | Context | Verdict |
|---|---|---|---|---|
| `app/(app)/history/[id].tsx:287` | `Plus` | `#6b7280` (gray-500) | Action button | Visible on both themes; not ideal |
| `app/(app)/workout/[sessionId].tsx:264` | `Plus` | `#6b7280` | Set row action | Same |
| `app/(app)/workout/[sessionId].tsx:274` | `Calculator` | `#6b7280` | Plate calc trigger | Same |
| `app/(app)/profile.tsx:104` | `ChevronRight` | `#9ca3af` (gray-400) | Row chevron | Same |
| `src/components/*` | Various chevrons/X/Trash | `#6b7280`, `#9ca3af`, `#ef4444` | List affordances, destructive | Same — gray tones work both ways; red is theme-agnostic |

### Why the bug only surfaced in PWA standalone
- iOS Safari **standalone (PWA)** respects the system theme by default.
- iOS Safari **regular tab** can be set by the user to force light mode for websites (Settings → Safari → Page Settings → Auto / Always Light), OR follow system.
- In the user's case: regular browser displayed in light mode → black icon on white background → visible. PWA respected dark system theme → black icon on black background → invisible.
- **The bug exists in both contexts**; PWA was just the first surface where it became visible to the user.

## Root cause
Three icon instances use `color="#000"` or `color="#fff"` without adapting to the active color scheme.

## Severity classification
- **Blocker** — `exercises/index.tsx:25`, `routines/index.tsx:25`, `routines/[id]/index.tsx:190`. User-facing primary actions invisible.
- **Minor (deferred)** — the gray-tone icons. They render acceptably on both themes; they violate the project's `dark:` adaptation convention but do not impair function. Track for future cleanup pass.

## Diagnostician-mode learnings (for playbook extraction)
- Grep was the right first move once the symptom class was known. Took ~3 minutes from "we know it's a contrast issue" to full mapping of affected files.
- The triage table (blocker vs minor) emerged naturally once all instances were listed side-by-side. Would benefit from a fixed template in the future debug playbook.
- The "why only in PWA" question matters even when not blocking the fix — confirms the root cause is correctly identified and not coincidental.
