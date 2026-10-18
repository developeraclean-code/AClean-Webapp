// New automation must fail closed on missing/malformed canonical configuration.
export function strictCronEnabled(settings, key) {
  let jobs;
  try { jobs = JSON.parse(settings.cron_jobs || 'null'); } catch { return false; }
  return settings[key] === 'true' && Array.isArray(jobs)
    && jobs.some(job => job?.backendKey === key && job.active === true)
    && !jobs.some(job => job?.backendKey === key && job.active !== true);
}
