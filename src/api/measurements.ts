import { supabase } from "~/lib/supabase";
import type { MeasurementEntryRow } from "~/db/types";

export type MeasurementInput = {
  measuredAt: string; // ISO timestamptz
  weightKg: number | null;
  bodyFatPct: number | null;
  neckCm: number | null;
  chestCm: number | null;
  bicepsCm: number | null;
  forearmCm: number | null;
  waistCm: number | null;
  hipsCm: number | null;
  thighCm: number | null;
  calfCm: number | null;
  notes: string | null;
};

/**
 * Thrown by createMeasurement / updateMeasurement when Postgres rejects the
 * write with `unique_violation` (SQLSTATE 23505) on
 * `measurement_entries_user_day_idx` (the partial UNIQUE on the UTC calendar
 * day). Carries `existingDateIso` (the date submitted, in YYYY-MM-DD form) so
 * the UI can deep-link to the existing entry.
 *
 * NOTE (MIN-2026.05-5): the discrimination uses Postgres SQLSTATE + a match
 * on the index name in `error.message`. The constraint-name lookup is the
 * fragile bit. If another UNIQUE index is added to `measurement_entries`,
 * this discrimination logic must be updated to disambiguate which constraint
 * fired — otherwise unrelated unique violations could be swallowed as
 * "duplicate date" errors.
 */
export class DuplicateMeasurementDateError extends Error {
  readonly existingDateIso: string;
  constructor(existingDateIso: string) {
    super(`A measurement already exists for ${existingDateIso}.`);
    this.name = "DuplicateMeasurementDateError";
    this.existingDateIso = existingDateIso;
  }
}

type SupabaseLikeError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

function isDuplicateDayConstraint(err: SupabaseLikeError): boolean {
  if (err.code !== "23505") return false;
  const haystack = `${err.message ?? ""} ${err.details ?? ""}`;
  return haystack.includes("measurement_entries_user_day_idx");
}

function isoToYyyyMmDd(iso: string): string {
  // Use UTC slice — the unique index is keyed on the UTC calendar day.
  return iso.slice(0, 10);
}

function toRowPayload(
  userId: string,
  input: MeasurementInput,
): Record<string, string | number | null> {
  return {
    user_id: userId,
    measured_at: input.measuredAt,
    weight_kg: input.weightKg,
    body_fat_pct: input.bodyFatPct,
    neck_cm: input.neckCm,
    chest_cm: input.chestCm,
    biceps_cm: input.bicepsCm,
    forearm_cm: input.forearmCm,
    waist_cm: input.waistCm,
    hips_cm: input.hipsCm,
    thigh_cm: input.thighCm,
    calf_cm: input.calfCm,
    notes: input.notes,
  };
}

function toPatchPayload(
  input: MeasurementInput,
): Record<string, string | number | null> {
  return {
    measured_at: input.measuredAt,
    weight_kg: input.weightKg,
    body_fat_pct: input.bodyFatPct,
    neck_cm: input.neckCm,
    chest_cm: input.chestCm,
    biceps_cm: input.bicepsCm,
    forearm_cm: input.forearmCm,
    waist_cm: input.waistCm,
    hips_cm: input.hipsCm,
    thigh_cm: input.thighCm,
    calf_cm: input.calfCm,
    notes: input.notes,
  };
}

export async function listMeasurements(): Promise<MeasurementEntryRow[]> {
  const { data, error } = await supabase
    .from("measurement_entries")
    .select("*")
    .is("deleted_at", null)
    .order("measured_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as MeasurementEntryRow[];
}

export async function getMeasurement(id: string): Promise<MeasurementEntryRow> {
  const { data, error } = await supabase
    .from("measurement_entries")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error) throw error;
  return data as MeasurementEntryRow;
}

export async function createMeasurement(
  input: MeasurementInput,
): Promise<MeasurementEntryRow> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("measurement_entries")
    .insert(toRowPayload(userId, input))
    .select()
    .single();
  if (error) {
    if (isDuplicateDayConstraint(error)) {
      throw new DuplicateMeasurementDateError(isoToYyyyMmDd(input.measuredAt));
    }
    throw error;
  }
  return data as MeasurementEntryRow;
}

export async function updateMeasurement(
  id: string,
  patch: MeasurementInput,
): Promise<MeasurementEntryRow> {
  const { data, error } = await supabase
    .from("measurement_entries")
    .update(toPatchPayload(patch))
    .eq("id", id)
    .select()
    .single();
  if (error) {
    if (isDuplicateDayConstraint(error)) {
      throw new DuplicateMeasurementDateError(isoToYyyyMmDd(patch.measuredAt));
    }
    throw error;
  }
  return data as MeasurementEntryRow;
}

export async function softDeleteMeasurement(id: string): Promise<void> {
  const { error } = await supabase
    .from("measurement_entries")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
