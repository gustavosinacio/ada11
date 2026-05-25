/**
 * Auto-fill set helper — computes the partial `updateSet` patch needed to
 * back-fill empty/zero weight or reps from the row's placeholder source
 * (the "previous completed set" already rendered as the input's
 * `placeholder` text).
 *
 * Caller responsibilities:
 *  - Gate on `set_type === "working"` (warmups/dropsets are out of spec).
 *  - Apply the returned patch via `updateSet.mutateAsync({ id, patch })`
 *    BEFORE flipping `completed_at` via `checkSet`, so the F10 "checked =
 *    committed" invariant holds (no window where a checked set has null
 *    weight/reps).
 *  - Treat a `null` return as "nothing to write, skip the updateSet call".
 *
 * The predicate operates on the LIVE typed strings the user has on screen
 * (so a value typed-but-not-blurred is honored, never clobbered) and on the
 * canonical placeholder source (kg-string for weight, integer for reps).
 *
 * No React, no side effects, no imports outside `~/db/types`.
 */

export type AutoFillPayload = {
  /** Canonical kg-string copied verbatim from `previous.weight`. Omitted
   *  when the user's typed weight is non-empty/non-zero OR previous.weight
   *  is unusable (null or parses to 0). */
  weight?: string;
  /** Integer reps copied from `previous.reps`. Omitted when the user's
   *  typed reps is non-empty/non-zero OR previous.reps is unusable (null
   *  or 0). */
  reps?: number;
};

type AutoFillArgs = {
  currentInput: { weight: string; reps: string };
  previous: { weight: string | null; reps: number | null } | null | undefined;
};

/**
 * Returns the partial patch needed to auto-fill an empty/zero set from its
 * placeholder source. Returns `null` when no auto-fill is needed (no fields
 * empty, or no usable previous on the empty fields).
 *
 * Predicate per field on `currentInput`:
 *   weightInputEmpty = currentInput.weight === "" || parseFloat(currentInput.weight) === 0
 *   repsInputEmpty   = currentInput.reps   === "" || Number(currentInput.reps)   === 0
 *
 * Source usability per field on `previous`:
 *   previousHasWeight = previous?.weight != null && parseFloat(previous.weight) > 0
 *   previousHasReps   = previous?.reps   != null && previous.reps   > 0
 *
 * - If `weightInputEmpty && previousHasWeight`, patch.weight = previous.weight (canonical kg-string).
 * - If `repsInputEmpty && previousHasReps`,    patch.reps   = previous.reps.
 * - Returns null if the patch would be empty.
 *
 * Never returns `{ weight: null }` or `{ reps: null }` — only positive writes.
 */
export function computeAutoFillPayload(
  args: AutoFillArgs,
): AutoFillPayload | null {
  const { currentInput, previous } = args;

  const weightTrimmed = currentInput.weight.trim();
  const repsTrimmed = currentInput.reps.trim();

  const weightInputEmpty =
    weightTrimmed === "" ||
    parseFloat(weightTrimmed.replace(",", ".")) === 0;
  const repsInputEmpty = repsTrimmed === "" || Number(repsTrimmed) === 0;

  const previousHasWeight =
    previous != null &&
    previous.weight != null &&
    parseFloat(previous.weight) > 0;
  const previousHasReps =
    previous != null && previous.reps != null && previous.reps > 0;

  const patch: AutoFillPayload = {};

  if (weightInputEmpty && previousHasWeight) {
    // previous.weight is canonical kg-string ("100.00"). Pass through verbatim.
    patch.weight = previous!.weight as string;
  }
  if (repsInputEmpty && previousHasReps) {
    patch.reps = previous!.reps as number;
  }

  if (patch.weight === undefined && patch.reps === undefined) return null;
  return patch;
}
