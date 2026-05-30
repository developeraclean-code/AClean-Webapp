// Shared Supabase client (anon key). Dipakai modul Project (src/project/*).
// persistSession:false → hindari warning "Multiple GoTrueClient instances"
// karena App.jsx membuat client-nya sendiri; app pakai custom auth, bukan
// Supabase Auth session, jadi tidak perlu persist sesi di client ini.
import { createClient } from "@supabase/supabase-js";

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPA_URL) throw new Error("[CRITICAL] VITE_SUPABASE_URL env var is required but not set.");
if (!SUPA_KEY) throw new Error("[CRITICAL] VITE_SUPABASE_ANON_KEY env var is required but not set.");

export const supabase = createClient(SUPA_URL, SUPA_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
