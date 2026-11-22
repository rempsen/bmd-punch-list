import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * The generated Supabase types are owned by the hosting platform and lag behind the
 * BMD Projects tables. Platform modules use this loosely typed handle and declare
 * their own row types next to the queries.
 */
export const db = supabase as unknown as SupabaseClient;

export const errText = (e: unknown) =>
  e instanceof Error ? e.message : String((e as { message?: string } | null)?.message ?? e);
