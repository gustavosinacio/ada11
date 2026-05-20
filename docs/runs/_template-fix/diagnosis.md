# Diagnosis — <run-id>

## Hypothesis (state BEFORE searching)
<your guess from the repro, before code investigation. Format: "Given repro X, I suspect the cause is Y, because Z.">

## Evidence

### Source-of-truth files (verified by reading)
- `file:line` — <what this code does, how it relates to the bug>
- ...

### Candidate locations affected by the same root cause
| File:Line | Token / pattern | Context | Severity |
|---|---|---|---|
| `path:N` | `code snippet` | <what it does> | blocker / major / minor |

### Cross-environment confirmation
<why does this bug manifest in environment X but not Y? If it should manifest in both but the user only noticed one, say so. If your explanation doesn't account for the environment specificity, the root cause is not fully nailed down — investigate further.>

## Root cause
<concise statement of the actual cause — what code / config / data is responsible. Distinguish from the symptom.>

## Severity classification
- **Blocker** — must fix; user-facing or data-affecting.
  - `path:N` — <reason>
- **Major** — should fix in this run; significant risk if left.
  - `path:N` — <reason>
- **Minor (out of scope by default)** — note for follow-up; not addressed in this run.
  - `path:N` — <reason>

## Symptom-only fix risk
<if you can only find a fix at the symptom level (not the root cause), explain. Symptom fixes are sometimes the right call but should be a conscious decision, not an accident.>
