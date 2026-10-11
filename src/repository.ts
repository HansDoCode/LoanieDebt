import { createClient } from "@supabase/supabase-js";
import { emptyData, normalizeData } from "./domain";
import type { AppData } from "./types";

const localKey = "lanies-debt-manager:data:v1";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const cloudConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase = cloudConfigured ? createClient(supabaseUrl!, supabaseAnonKey!) : null;

function readLocal(): AppData {
  const raw = localStorage.getItem(localKey);
  if (!raw) return emptyData();
  try {
    return normalizeData(JSON.parse(raw));
  } catch {
    throw new Error("The saved local data could not be read. Exported backups are unaffected.");
  }
}

export async function loadData(userId?: string): Promise<AppData> {
  if (!supabase || !userId) return readLocal();
  const { data, error } = await supabase
    .from("app_state")
    .select("data")
    .eq("owner_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.data ? normalizeData(data.data) : emptyData();
}

export async function saveData(next: AppData, userId?: string): Promise<void> {
  const normalized = normalizeData(next);
  if (!supabase || !userId) {
    localStorage.setItem(localKey, JSON.stringify(normalized));
    return;
  }
  const { error } = await supabase.from("app_state").upsert(
    { owner_id: userId, data: normalized, updated_at: new Date().toISOString() },
    { onConflict: "owner_id" },
  );
  if (error) throw error;
}

export function localDataExists(): boolean {
  return Boolean(localStorage.getItem(localKey));
}
