# Regression report — <run-id>

## Environment
- Build: <local dev | web export | etc.>
- Test data: <fresh user | seeded | specific account>

## Automated checks
| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | pass / fail |
| Lint | `npm run lint` | pass / fail |
| Unit tests | `npm run test:unit` | N pass / M fail |
| Web export build | `npx expo export --platform web` | pass / fail |

## Replay of original reproduction
**Steps from `repro.md`**:
1. ...
2. ...

**Result**: <bug no longer reproduces | bug still reproduces | cannot-test-locally — see manual checklist>
**Evidence**:
```
<command output, log snippet, screenshot path>
```

## Adjacent regression checks
- **<screen / flow A>**: <pass | fail> — <evidence>
- **<screen / flow B>**: <pass | fail> — <evidence>
- **<screen / flow C>**: <pass | fail> — <evidence>

## Manual verification checklist (only if Conductor cannot test locally)
Action for user:
1. ...
2. ...
3. ...

## Code-level confirmation
| File | Before | After |
|---|---|---|
| `path:line` | `<old>` | `<new>` |

## Out-of-scope confirmation
- <items intentionally left untouched per fix-plan.md `Out of scope` section — verified not regressed>

## Decision

**< pass | fail >**

Reasoning:
- <if pass: summary of what was verified; flag any limitation (e.g. PWA-on-iOS must be verified by user)>
- <if fail: which checks broke, what Implementer must address>

## Post-deploy manual verification (filled in after user confirms)
- Verified by user on <environment>: <pass | fail>.
- Confirmation timestamp (BRT): <YYYY-MM-DD HH:mm>.
- User statement: "<verbatim>"
