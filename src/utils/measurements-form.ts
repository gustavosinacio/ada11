import { format, parse } from "date-fns";
import { z } from "zod";

import type { MeasurementEntryRow, LengthUnit, WeightUnit } from "~/db/types";
import type { MeasurementInput } from "~/api/measurements";
import {
  cmToIn,
  kgToLbs,
  parseLengthToCm,
  parseWeightToKg,
} from "./units";

// ---------------------------------------------------------------------------
// Form-side value shape: ALL fields are strings (or empty string). React Hook
// Form `defaultValues` must mirror this shape exactly.
// ---------------------------------------------------------------------------

export type MeasurementFormValues = {
  measuredAt: string;
  weightKg: string;
  bodyFatPct: string;
  neckCm: string;
  chestCm: string;
  bicepsCm: string;
  forearmCm: string;
  waistCm: string;
  hipsCm: string;
  thighCm: string;
  calfCm: string;
  notes: string;
};

export function formatDateInput(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function emptyMeasurementFormValues(today: Date): MeasurementFormValues {
  return {
    measuredAt: formatDateInput(today),
    weightKg: "",
    bodyFatPct: "",
    neckCm: "",
    chestCm: "",
    bicepsCm: "",
    forearmCm: "",
    waistCm: "",
    hipsCm: "",
    thighCm: "",
    calfCm: "",
    notes: "",
  };
}

// ---------------------------------------------------------------------------
// Zod schema operates on STRINGS. Range / at-least-one checks live in
// `buildSubmitPayload` below (they need access to the unit context to convert
// the form's display string into a canonical kg/cm number before checking).
// ---------------------------------------------------------------------------

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const optStr = z.string().trim().optional().or(z.literal(""));

export const measurementsSchema = z.object({
  measuredAt: dateStr,
  weightKg: optStr,
  bodyFatPct: optStr,
  neckCm: optStr,
  chestCm: optStr,
  bicepsCm: optStr,
  forearmCm: optStr,
  waistCm: optStr,
  hipsCm: optStr,
  thighCm: optStr,
  calfCm: optStr,
  notes: z.string().trim().max(500, "Too long").optional().or(z.literal("")),
});

export function parseOptionalDecimal(s: string): number | null {
  const trimmed = (s ?? "").trim().replace(",", ".");
  if (!trimmed) return null;
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : null;
}

type MetricKey =
  | "weightKg"
  | "bodyFatPct"
  | "neckCm"
  | "chestCm"
  | "bicepsCm"
  | "forearmCm"
  | "waistCm"
  | "hipsCm"
  | "thighCm"
  | "calfCm";

const RANGES: Record<MetricKey, [number, number]> = {
  weightKg: [20, 400],
  bodyFatPct: [2, 60],
  neckCm: [5, 250],
  chestCm: [5, 250],
  bicepsCm: [5, 250],
  forearmCm: [5, 250],
  waistCm: [5, 250],
  hipsCm: [5, 250],
  thighCm: [5, 250],
  calfCm: [5, 250],
};

// ---------------------------------------------------------------------------
// Submit pipeline: parse strings → canonical numbers → range-check → build
// MeasurementInput. Throws a `z.ZodError` on range failure so RHF can surface
// the message inline against the right field.
// ---------------------------------------------------------------------------

type UnitContext = { weightUnit: WeightUnit; lengthUnit: LengthUnit };

export function buildSubmitPayload(
  values: MeasurementFormValues,
  ctx: UnitContext,
): MeasurementInput {
  const { weightUnit, lengthUnit } = ctx;
  // Guard against impossible-but-regex-passing dates (e.g. 2026-13-99,
  // 2026-02-30, 2026-02-29 in a non-leap year). `parse` returns an Invalid
  // Date for these and `.toISOString()` would throw RangeError, which the
  // screens do not catch. Convert into a ZodError so the existing
  // setError("measuredAt", ...) path renders an inline field message.
  const parsed = parse(values.measuredAt, "yyyy-MM-dd", new Date());
  if (Number.isNaN(parsed.getTime())) {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        path: ["measuredAt"],
        message: "Invalid date",
      },
    ]);
  }
  const measuredAtIso = parsed.toISOString();

  const weightKg =
    values.weightKg.trim() === ""
      ? null
      : parseWeightToKg(values.weightKg, weightUnit);
  const bodyFatPct = parseOptionalDecimal(values.bodyFatPct);
  const parseLen = (s: string) =>
    s.trim() === "" ? null : parseLengthToCm(s, lengthUnit);

  const payload: MeasurementInput = {
    measuredAt: measuredAtIso,
    weightKg,
    bodyFatPct,
    neckCm: parseLen(values.neckCm),
    chestCm: parseLen(values.chestCm),
    bicepsCm: parseLen(values.bicepsCm),
    forearmCm: parseLen(values.forearmCm),
    waistCm: parseLen(values.waistCm),
    hipsCm: parseLen(values.hipsCm),
    thighCm: parseLen(values.thighCm),
    calfCm: parseLen(values.calfCm),
    notes: values.notes.trim() === "" ? null : values.notes.trim(),
  };

  // Range check on canonical values.
  const issues: { path: MetricKey; message: string }[] = [];
  (Object.keys(RANGES) as MetricKey[]).forEach((key) => {
    const range = RANGES[key];
    const v = payload[key];
    if (v != null && (v < range[0] || v > range[1])) {
      issues.push({
        path: key,
        message: `Must be between ${range[0]} and ${range[1]}`,
      });
    }
  });
  if (issues.length > 0) {
    throw new z.ZodError(
      issues.map((i) => ({
        code: z.ZodIssueCode.custom,
        path: [i.path],
        message: i.message,
      })),
    );
  }

  // At-least-one metric required.
  const anyMetric =
    weightKg != null ||
    bodyFatPct != null ||
    payload.neckCm != null ||
    payload.chestCm != null ||
    payload.bicepsCm != null ||
    payload.forearmCm != null ||
    payload.waistCm != null ||
    payload.hipsCm != null ||
    payload.thighCm != null ||
    payload.calfCm != null;
  if (!anyMetric) {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        path: ["weightKg"],
        message: "Log at least one measurement",
      },
    ]);
  }

  return payload;
}

// ---------------------------------------------------------------------------
// rowToFormValues — MIN-2026.05-3 adapter. Converts a stored (canonical) row
// into the display-string shape the form expects, applying the user's current
// unit preferences so the displayed numbers match what they would type.
// ---------------------------------------------------------------------------

function formatLengthForInput(cm: string | null, unit: LengthUnit): string {
  if (cm == null) return "";
  const n = parseFloat(cm);
  if (!Number.isFinite(n)) return "";
  const value = unit === "cm" ? n : cmToIn(n);
  return value.toFixed(1);
}

function formatWeightForInput(kg: string | null, unit: WeightUnit): string {
  if (kg == null) return "";
  const n = parseFloat(kg);
  if (!Number.isFinite(n)) return "";
  const value = unit === "kg" ? n : kgToLbs(n);
  return value.toFixed(1);
}

function formatPercentForInput(pct: string | null): string {
  if (pct == null) return "";
  const n = parseFloat(pct);
  if (!Number.isFinite(n)) return "";
  return n.toFixed(1);
}

export function rowToFormValues(
  row: MeasurementEntryRow,
  ctx: UnitContext,
): MeasurementFormValues {
  const { weightUnit, lengthUnit } = ctx;
  return {
    measuredAt: row.measured_at.slice(0, 10),
    weightKg: formatWeightForInput(row.weight_kg, weightUnit),
    bodyFatPct: formatPercentForInput(row.body_fat_pct),
    neckCm: formatLengthForInput(row.neck_cm, lengthUnit),
    chestCm: formatLengthForInput(row.chest_cm, lengthUnit),
    bicepsCm: formatLengthForInput(row.biceps_cm, lengthUnit),
    forearmCm: formatLengthForInput(row.forearm_cm, lengthUnit),
    waistCm: formatLengthForInput(row.waist_cm, lengthUnit),
    hipsCm: formatLengthForInput(row.hips_cm, lengthUnit),
    thighCm: formatLengthForInput(row.thigh_cm, lengthUnit),
    calfCm: formatLengthForInput(row.calf_cm, lengthUnit),
    notes: row.notes ?? "",
  };
}
