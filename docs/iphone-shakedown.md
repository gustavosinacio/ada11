# iPhone shakedown — first real workout

Used to capture friction during the first real training session on the iPhone build. **Baseline: [Strong app](https://www.strong.app/).** Every place Ada11 makes you work harder than Strong is a candidate for the next sprint.

Fill this in **during** the session, not after — bad memory loses 80% of the small friction.

## Session metadata

- Date:
- Device:
- Build: `expo run:ios --device` / EAS build hash:
- Routine used: ad-hoc / saved routine name:
- Duration:

## End-to-end checklist (mark ✅ if it worked, ❌ + note if it didn't)

| # | Flow | Status | Strong-comparable? |
|---|---|---|---|
| 1 | Sign in (email or Google) | ⬜ | n/a |
| 2 | Toggle weight unit kg↔lbs, reload, confirm sticks | ⬜ | Strong: stored on device |
| 3 | Create a routine with name + notes | ⬜ | yes |
| 4 | Add 3+ exercises with target sets/reps/weight/rest | ⬜ | yes |
| 5 | Reorder exercises in routine | ⬜ | Strong has drag; Ada11 has up/down arrows |
| 6 | Start workout from routine | ⬜ | yes |
| 7 | Log a working set (weight + reps) | ⬜ | yes |
| 8 | Log a warmup set | ⬜ | yes |
| 9 | Log a dropset (chained to working) | ⬜ | yes |
| 10 | Edit a previously-logged set | ⬜ | yes |
| 11 | Delete a set | ⬜ | yes |
| 12 | Add a per-set note | ⬜ | yes |
| 13 | Use plate calculator from live workout | ⬜ | Strong: yes, with bar/plate presets |
| 14 | Finish session | ⬜ | yes |
| 15 | View session in History | ⬜ | yes |
| 16 | Open session detail, see all sets + notes | ⬜ | yes |
| 17 | Open exercise → View progress chart | ⬜ | Strong: yes (E1RM, max weight, total volume) |
| 18 | Pocket phone with rest timer running for 60s — does anything notify? | ⬜ | Strong: optional sound + haptic |

## Friction log

Format: `[severity] [category] description — vs. Strong: <comparison>`

Severity:
- 🔴 **Blocker**: can't complete the flow, or so bad I won't use it again
- 🟡 **Annoying**: works but slower / clunkier than Strong
- 🟢 **Nit**: cosmetic, polish-tier

Category: `bug` / `UX` / `missing-feature` / `perf` / `ios-specific`

Examples (delete these once filling in real ones):
- 🟡 UX: typing weight requires tapping the field — Strong opens the keyboard automatically when you start a set.
- 🟢 ios-specific: tab bar overlaps content on bottom — needs SafeAreaView padding.
- 🔴 missing-feature: no way to mark a set as "completed" — Strong tracks completed vs planned sets explicitly.

### Findings

- 🟢 UX (web-only): routine edit screen (`/routines/[id]`) is confusing on web — "Save details" button only covers name+notes, exercise targets autosave on blur with no visible "Saved" indicator, and there's no clear "done/exit" gesture. On iPhone the native back button serves as the exit + the data is confirmed saved on return to list, so this is fine on the primary surface. Lower priority. Possible fixes: rename "Save details" → "Save name & notes", add a subtle "Saved ✓" indicator on autosave fields, or add a "Done" button on web only.

## Strong features I missed having

What did your hand reach for that wasn't there? List, don't filter — even features you don't need yet count as signal.

-

## What surprised me (positive)

What worked better than expected, or that Strong doesn't do?

-

## Decision for next sprint

After cooling off, pick **one** feature to build next based on the Blocker / Annoying counts above. Write the choice + 1-sentence reasoning here. Don't start a second feature until this one ships.

-
