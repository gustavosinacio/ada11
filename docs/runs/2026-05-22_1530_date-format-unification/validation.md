# Validation v<N> — <run-id>

Reviewing: `design-v<N>.md`

## Verification of Designer's claims
| Claim | Verified? | Evidence |
|---|---|---|
| <Designer asserted X about file Y> | yes / no / partial | <file:line you checked> |

## Issues found

### Blockers
- **[BLK-1]** <file:line OR design section>: <what is wrong>. Suggested fix: <terse>.

### Majors
- **[MAJ-1]** <location>: <what is wrong>. Suggested fix: <terse>.

### Minors
- **[MIN-1]** <location>: <what is wrong>. Suggested fix: <terse>.

## Issues raised in previous validation (only if N > 1)
| ID (from v<N-1>) | Addressed? | Notes |
|---|---|---|
| [BLK-1] | yes / no / partial | <why> |

## Decision

**< go | no-go >**

Reasoning:
- <if `go` and there are majors, list them as known-debt to track>
- <if `no-go`, list the exact issues Designer must address in v(N+1)>
