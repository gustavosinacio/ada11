# Reproduction — 2026-05-20_0012_dark-mode-icon-contrast

## Initial report
"Algumas telas ficando em branco quando estão em views mobile. No momento isso acontece na tela de exercícios."

## Refinement (Reproducer-mode work)
Initial description was misleading — "telas em branco" suggested a complete render failure. Actual observation (via screenshot from the user):

- The screen renders fully.
- The list of exercises is visible and functional.
- The bottom tab bar is visible.
- **The "+" icon in the header (top-right) is rendered but barely visible** — hardcoded black on dark background.

Reframing the bug: this is a **dark-mode contrast issue with hardcoded icon colors**, not a blank-screen issue.

## Environment that triggers the bug
- iPhone, app installed via Safari "Add to Home Screen" → launched as PWA in standalone mode.
- iOS system theme: dark mode.
- Safari browser tab: bug not noticed there (likely user forces light mode for websites, or behavior differs).

## Affected screens (confirmed)
- `app/(app)/exercises/index.tsx` — header "+" button (user screenshot).
- `app/(app)/routines/index.tsx` — header "+" button (user confirmation).
- `app/(app)/routines/[id]/index.tsx` — "Add" button inside routine detail (found during diagnosis; symmetric symptom — white icon on white-background button in dark mode).

## Steps to reproduce
1. Open the deployed web build on Safari (iPhone).
2. Use "Add to Home Screen" to install as a PWA.
3. Set iPhone system theme to **Dark**.
4. Launch app from home screen.
5. Sign in.
6. Navigate to the **Exercises** tab (or **Routines** tab).
7. Observe the header — the "+" icon at top-right is nearly invisible.

## Visual evidence
User-provided screenshot of the Exercises screen in PWA + dark mode (inline in conversation). Faint "+" outline visible top-right of the "Exercises" header.

## Status
**Repro confirmed**, root cause investigation complete (see diagnosis.md).

## Reproducer-mode learnings (for playbook extraction)
- Verbal repro ("telas em branco") was misleading — visual evidence radically changed the bug class.
- **Lesson**: for any UI bug, request screenshot or screen recording in the first Reproducer round, before any code investigation. The user's mental description and the actual visual artifact may diverge significantly.
- Asking 3 questions via structured prompt felt heavy — user pushed back. Free-text follow-up + asking for visual evidence would have been faster.
