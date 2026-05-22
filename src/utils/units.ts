import type { LengthUnit, WeightUnit } from "~/db/types";

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;

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
 * Aggregate-volume formatter. Renders an integer with a thousands comma
 * separator (e.g. `"26,210 kg"`, `"840 kg"`). Locale fixed to en-US so devices
 * in pt-BR don't render `"26.210 kg"` (period as thousands separator), which
 * would re-introduce the readability problem the abbreviation removal was
 * meant to solve. Per-set displays should keep using `formatWeight`.
 */
export function formatVolume(
  kg: number | null | undefined,
  unit: WeightUnit,
): string {
  if (kg == null) return "—";
  const value = unit === "kg" ? kg : kgToLbs(kg);
  return `${Math.round(value).toLocaleString("en-US")} ${unit}`;
}

// ---------------------------------------------------------------------------
// Length helpers — mirror the kg quartet for circumference (cm) values.
// Canonical storage is centimeters; UI converts at the boundary.
// ---------------------------------------------------------------------------

export function cmToIn(cm: number): number {
  return cm / CM_PER_IN;
}

export function inToCm(inches: number): number {
  return inches * CM_PER_IN;
}

export function formatLength(
  cm: number | null | undefined,
  unit: LengthUnit,
): string {
  if (cm == null) return "—";
  const value = unit === "cm" ? cm : cmToIn(cm);
  return `${value.toFixed(1)} ${unit}`;
}

export function parseLengthToCm(input: string, unit: LengthUnit): number | null {
  const value = parseFloat(input.replace(",", "."));
  if (Number.isNaN(value)) return null;
  return unit === "cm" ? value : inToCm(value);
}
