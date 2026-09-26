import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

export async function fetchMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveMyProfile(userId: string, patch: ProfileUpdate) {
  const { error } = await supabase.from("profiles").upsert({ ...patch, id: userId });
  if (error) throw error;
}

export const VALUE_OPTIONS = [
  "Family",
  "Faith",
  "Honesty",
  "Loyalty",
  "Ambition",
  "Kindness",
  "Adventure",
  "Stability",
  "Growth",
  "Humour",
  "Generosity",
  "Tradition",
];
