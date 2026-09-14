export function normalizeAutomationJob(job, key, enabled) {
  return {
    ...(job || {}),
    backendKey: key,
    active: enabled === true,
  };
}

export function requireAppSettingsResult(result) {
  if (result?.error) throw new Error(result.error.message || "Gagal membaca app_settings");
  if (!Array.isArray(result?.data)) throw new Error("Respons app_settings tidak valid");
  return result.data;
}

export async function saveAutomationToggle(supabase, { key, enabled, job }) {
  if (!supabase?.rpc) throw new Error("Supabase client tidak tersedia");
  if (!key || !key.endsWith("_enabled")) throw new Error("Key otomasi tidak valid");

  const canonicalJob = normalizeAutomationJob(job, key, enabled);
  const { data, error } = await supabase.rpc("set_automation_setting", {
    p_key: key,
    p_enabled: enabled === true,
    p_job: canonicalJob,
  });

  if (error) throw new Error(error.message || "Gagal menyimpan pengaturan otomasi");
  if (!Array.isArray(data)) throw new Error("Respons cron_jobs dari database tidak valid");
  return data;
}
