# Test report v<N> — <run-id>

Testing: implementation against `design-v<N>.md`.

## Environment
- Commands used to run app: <e.g. `npm run web`>
- Browser / device: <e.g. Chrome 130 / iOS Simulator iPhone 15>
- Test data: <fresh user / seeded user / specific account>

## Golden path
**Spec** (from design): <what the feature should do>

**Steps run**:
1. ...
2. ...

**Result**: <pass | fail>

**Evidence**:
```
<terminal output, log snippet, or "screenshot at docs/runs/<run-id>/screenshots/golden.png">
```

## Edge cases

### Edge 1: <name>
**Steps**: ...
**Expected**: ...
**Actual**: ...
**Result**: <pass | fail>
**Evidence**: ...

### Edge 2: <name>
**Steps**: ...
**Expected**: ...
**Actual**: ...
**Result**: <pass | fail>
**Evidence**: ...

## Regression check
- **<adjacent feature>**: <pass | fail> — <evidence>

## Cross-platform
- Web: <pass | fail | not tested — reason>
- iOS: <pass | fail | not tested — reason>
- Android: <pass | fail | not tested — reason>

## Test commands
- [ ] `npm run typecheck` — <output summary>
- [ ] `npm run lint` — <output summary>
- [ ] `npm run test:unit` — <output summary>
- [ ] `npm run test:e2e` — <output summary, if applicable>

## Decision

**< pass | fail >**

Reasoning:
- <if pass: summary>
- <if fail: which scenarios broke, what the Implementer must address>
