# Review v<N> — <run-id>

Reviewing: the diff for the implementation against `design-v<N>.md`.

## Diff scope
- Diff command: `git diff <baseline_commit>...HEAD` (baseline recorded in `state.md`)
- Files changed: <count>
- Lines: +<X> / -<Y>

## Verification of implementation.md claims
| Claim | Verified? | Notes |
|---|---|---|
| <claim> | yes / no / partial | <file:line you confirmed> |

## Issues

### Blockers
- **[BLK-1]** `file:line`: <what is wrong>. Fix: <terse>.

### Majors
- **[MAJ-1]** `file:line`: <what is wrong>. Fix: <terse>.

### Minors
- **[MIN-1]** `file:line`: <what is wrong>. Fix: <terse>.

## Security checklist
- [ ] RLS: new queries land on protected tables; any new table has an RLS policy.
- [ ] No `SUPABASE_SERVICE_ROLE_KEY` or other service-role token in client-bundled code.
- [ ] Any raw SQL via `rpc` is parameterized; no string concat of user input.
- [ ] `EXPO_PUBLIC_*` env vars contain no secrets.

## Style / convention checklist
- [ ] No new `any`.
- [ ] No new `// @ts-ignore`.
- [ ] Comments narrate *why*, not *what*.
- [ ] Imports follow project style.
- [ ] New files placed in conventional folder.

## Decision

**< pass | fail >**

Reasoning:
- <if pass: summary; note any majors-as-debt>
- <if fail: which issues the Implementer must address>
