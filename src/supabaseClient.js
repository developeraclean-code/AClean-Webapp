// Satu-satunya Supabase client (anon key) untuk seluruh app + modul Project.
// persistSession:true (default) WAJIB — login pakai Supabase Auth
// (supabase.auth.signInWithPassword). Tanpa persist, request jadi role `anon`
// → RLS tabel project_* (TO authenticated) memblok insert/update.
// Single client juga menghilangkan warning "Multiple GoTrueClient instances".
import { createClient } from "@supabase/supabase-js";

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPA_URL) throw new Error("[CRITICAL] VITE_SUPABASE_URL env var is required but not set.");
if (!SUPA_KEY) throw new Error("[CRITICAL] VITE_SUPABASE_ANON_KEY env var is required but not set.");

export const supabase = createClient(SUPA_URL, SUPA_KEY);
