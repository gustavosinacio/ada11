import { supabase } from "~/lib/supabase";
import type { LengthUnit, MaxVolumeWindowWeeks, WeightUnit } from "~/db/types";

export type UserPreferencesRow = {
  user_id: string;
  weight_unit: WeightUnit;
  length_unit: LengthUnit;
  max_volume_window_weeks: MaxVolumeWindowWeeks;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export async function getMyPreferences(): Promise<UserPreferencesRow | null> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("user_preferences")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as UserPreferencesRow | null) ?? null;
}

export async function setWeightUnit(unit: WeightUnit): Promise<UserPreferencesRow> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("user_preferences")
    .update({ weight_unit: unit })
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw error;
  return data as UserPreferencesRow;
}

export async function setLengthUnit(unit: LengthUnit): Promise<UserPreferencesRow> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("user_preferences")
    .update({ length_unit: unit })
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw error;
  return data as UserPreferencesRow;
}

export async function setMaxVolumeWindowWeeks(
  weeks: MaxVolumeWindowWeeks,
): Promise<UserPreferencesRow> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("user_preferences")
    .update({ max_volume_window_weeks: weeks })
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw error;
  return data as UserPreferencesRow;
}
