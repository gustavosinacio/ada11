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
