import type { MeasurementEntryRow } from "~/db/types";
import { parseISO } from "~/utils/dates";

/**
 * Bodyweight-as-load arithmetic + as-of-session resolution. The single seam
 * that makes the app's "same volume number everywhere" invariant real: every
 * volume kernel routes its per-set weight through `effectiveWeightKg`, so the
 * only branch that can change a number is `equipment === "bodyweight"`.
 *
 * Pure: no React, no I/O — unit-testable under vitest.
 */

/**
 * Effective per-set load in kg. The single arithmetic seam for the
 * "same number everywhere" invariant.
 *
 *   - equipment === "bodyweight": effective = (bodyweightKg ?? 0) * factor + addedLoad
 *   - any other equipment (incl. legacy strings, null): effective = addedLoad
 *
 * addedLoad = weight == null ? 0 : parseFloat(weight)  (NaN-safe: a
 * non-finite parse → 0). bodyweightKg is the resolved as-of-session
 * bodyweight or null. The bodyweight addend ONLY fires on the exact canonical
 * token "bodyweight" (Decision #7) — a 0-weight machine set stays 0
 * (Decision #6). Returns a finite number >= 0; never NaN.
 *
 * `factor` (optional 4th arg) is the per-exercise bodyweight leverage factor:
 * a push-up moves ≈0.64 BW, a pull-up/dip ≈1.0 BW. It scales ONLY the
 * bodyweight component — `bw * factor + addedLoad`, NEVER `(bw + addedLoad) *
 * factor` — so a weighted dip's belt/vest load is a true external load,
 * leveraged at 1.0.
 *
 * The factor is a `numeric` column, so PostgREST returns it as a JSON STRING
 * (`"0.64"`). The seam accepts `number | string | null` and `parseFloat`s a
 * string internally. Coalesce rule: NULL / undefined / non-numeric string /
 * NaN / ±Infinity ⇒ factor = 1.0 (NEVER 0 — a 0 here would zero out every
 * bodyweight volume app-wide). A stored finite `"0"` is honored as a
 * deliberate value (the catalog never writes 0; min is 0.50).
 *
 * Invariant L (no-change-when-absent): called with the 4th arg omitted, or
 * with `factor` NULL/non-finite, coalesces to 1.0 and reproduces byte-for-byte
 * the pre-feature `bw + addedLoad`.
 */
export function effectiveWeightKg(
  equipment: string | null | undefined,
  weight: string | null,
  bodyweightKg: number | null,
  factor?: number | string | null,
): number {
  const parsed = weight == null ? 0 : parseFloat(weight);
  const addedLoad = Number.isFinite(parsed) ? parsed : 0;
  if (equipment === "bodyweight") {
    const bw = bodyweightKg != null && Number.isFinite(bodyweightKg)
      ? bodyweightKg
      : 0;
    // Coalesce-to-1.0-NEVER-0. numeric arrives as "0.64"; parseFloat it.
    let f: number;
    if (factor == null) {
      f = 1;
    } else {
      const n = typeof factor === "string" ? parseFloat(factor) : factor;
      f = Number.isFinite(n) ? n : 1; // NaN/Infinity/"abc" ⇒ 1.0, NEVER 0
    }
    return bw * f + addedLoad; // addedLoad NEVER scaled
  }
  return addedLoad; // non-bodyweight never reads the factor
}

/**
 * Resolves the user's bodyweight (kg) as of `instantMs` (a UTC ms instant,
 * typically parseISO(session.started_at).getTime()).
 *
 * `measurements` is the raw `useMeasurements` result (DESC by measured_at per
 * `listMeasurements`, but this function does NOT rely on input order — it
 * filters + scans). Only entries with a non-null, finite `weight_kg` are
 * considered (mirrors `measurements-chart.ts:29-31`).
 *
 * Fallback rule (all branches unit-tested — Decision #2):
 *   1. nearest PRIOR weigh-in: max(measured_at) s.t. measured_at <= instantMs
 *      AND weight_kg finite. Compare on parseISO(measured_at).getTime()
 *      (both UTC instants) — NO local-day rounding.
 *   2. else nearest LATER weigh-in: min(measured_at) s.t.
 *      measured_at > instantMs AND weight_kg finite.
 *   3. else (user never logged a finite weight_kg): return null.
 * Returns kg as a finite number, or null.
 */
export function bodyweightKgAsOf(
  measurements: MeasurementEntryRow[] | undefined,
  instantMs: number,
): number | null {
  if (!measurements || measurements.length === 0) return null;

  let priorMs = -Infinity;
  let priorKg: number | null = null;
  let laterMs = Infinity;
  let laterKg: number | null = null;

  for (const m of measurements) {
    if (m.weight_kg == null) continue;
    const kg = parseFloat(m.weight_kg);
    if (!Number.isFinite(kg)) continue;
    const ms = parseISO(m.measured_at).getTime();
    if (!Number.isFinite(ms)) continue;

    if (ms <= instantMs) {
      // Nearest PRIOR (or exact-instant) weigh-in: keep the latest one.
      if (ms > priorMs) {
        priorMs = ms;
        priorKg = kg;
      }
    } else {
      // Nearest LATER weigh-in: keep the earliest one.
      if (ms < laterMs) {
        laterMs = ms;
        laterKg = kg;
      }
    }
  }

  if (priorKg != null) return priorKg;
  if (laterKg != null) return laterKg;
  return null;
}
