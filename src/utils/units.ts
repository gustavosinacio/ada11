import type { WeightUnit } from "~/db/types";

const KG_PER_LB = 0.45359237;

export function kgToLbs(kg: number): number {
  return kg / KG_PER_LB;
}

export function lbsToKg(lbs: number): number {
  return lbs * KG_PER_LB;
}

export function formatWeight(kg: number | null | undefined, unit: WeightUnit): string {
  if (kg == null) return "—";
  const value = unit === "kg" ? kg : kgToLbs(kg);
  return `${value.toFixed(1)} ${unit}`;
}

export function parseWeightToKg(input: string, unit: WeightUnit): number | null {
  const value = parseFloat(input.replace(",", "."));
  if (Number.isNaN(value)) return null;
  return unit === "kg" ? value : lbsToKg(value);
}

/**
 * Aggregate-volume formatter. Distinct from `formatWeight` because volume
 * readouts (a) abbreviate above 1000 with one decimal (`"12.4k kg"`), and
 * (b) drop decimals for whole values (`"840 kg"`) so the eye can scan at a
 * glance. Per-set displays should keep using `formatWeight`.
 *
 * Boundary rule (MIN-3): we round-then-compare. 999.5 kg rounds to 1000 and
 * renders as `"1.0k kg"`, avoiding the kg-vs-lbs asymmetry where the same
 * underlying volume would abbreviate in one unit and not the other.
 */
export function formatVolume(
  kg: number | null | undefined,
  unit: WeightUnit,
): string {
  if (kg == null) return "—";
  const value = unit === "kg" ? kg : kgToLbs(kg);
  const rounded = Math.round(value);
  if (rounded >= 1000) {
    return `${(value / 1000).toFixed(1)}k ${unit}`;
  }
  return `${rounded} ${unit}`;
}
