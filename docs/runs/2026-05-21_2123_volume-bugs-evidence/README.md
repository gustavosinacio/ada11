# Volume + workout-UX evidence (2026-05-21 21:23 BRT)

> Started as a "volume bugs" folder; expanded into a general workspace for
> open items observed during the 2026-05-21 evening session.

Backing evidence for the two open items in `docs/features.md`:

1. Weekly volume count on History screen looks wrong.
2. "Volume to PR" per-exercise (F11 strip) looks wrong.

## Screenshot — live workout, F11 strip

Drop the screenshot at: `./live-workout-volume-to-pr.png`

Captured values from the screenshot (live workout, 2 exercises, **zero working sets logged so far** — elapsed 00:35):

| Exercise        | Volume to PR shown |
| --------------- | ------------------ |
| Bench Press     | **4.9k kg**        |
| Squat (Barbell) | **5.8k kg**        |

User claim (anchoring): a single set of 120 kg × 8 = 960 kg of bench press has been logged historically. So **previous best for bench should be ≥ 960 kg**, and the "Volume to PR" remaining at the start of a new session should equal that previous best (since current-session volume = 0). 4.9k kg implies the strip thinks previous-best bench volume is 4 900 kg — five sessions' worth of work in a single PR session, which is unlikely on the same calendar week as a fresh 120×8 set.

Possible classes:

- "Previous PR" is summing volume across **multiple sessions** instead of picking the single best session.
- "Previous PR" is summing across the **entire exercise history** (all sets ever).
- Unit mismatch (treating reps as kg, etc.).
- Imported Strong rows are counting toward "previous best" with inflated values.

## Screenshot — history weekly total

Drop the screenshot at: `./history-weekly-total.png`

Captured value: **THIS WEEK 26.2k kg** (week of 2026-05-18).

## Related code

- `src/components/weekly-volume-strip.tsx` — History weekly bar (`computeStripModel`).
- F11 per-exercise "Volume to PR" — exact file TBD on next debug pass. The strip shown in the screenshot is the one shipped by run `2026-05-21_*_volume-to-pr` (see `docs/runs/`).
- `src/api/stats.ts` — `listWeeklyVolumeRows`.

## Why this matters

Both bugs sit in the **volume math layer**. If one is wrong, the other likely shares a root cause (e.g. Strong-imported rows are double-counted, or warmups/unfinished sessions are leaking through). Triage should start with a single read-only diagnostic that covers both surfaces before deciding on a fix.
