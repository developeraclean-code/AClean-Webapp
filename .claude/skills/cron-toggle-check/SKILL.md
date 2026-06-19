---
name: cron-toggle-check
description: Audit every cron/WhatsApp scheduled task to confirm it gates on the project's mandatory AND-logic toggle (isCronJobEnabled + standalone key) so WA never leaks to customers when a toggle is OFF. Use when the user wants to check cron toggles, add a new cron task, debug "WA bocor saat toggle OFF", or review api/cron-reminder.js.
---

# Cron Toggle Checker

This project's #1 WhatsApp safety rule: **every cron task must gate on AND-logic** so
a disabled toggle can never leak WA to customers. Missing/half checks have caused real
leaks (see migration 5175538 "cron toggle leak" and the cron-toggle pattern in CLAUDE.md).

## The required pattern

```js
// Fetch MUST include the "cron_jobs" key alongside the standalone key(s)
const { data } = await sb.from("app_settings").select("key,value")
  .in("key", ["my_feature_enabled", "cron_jobs", ...otherKeys]);
const togMap = Object.fromEntries(data.map(r => [r.key, r.value]));

// Check MUST use BOTH isCronJobEnabled() AND the standalone key === "true"
if (!isCronJobEnabled(togMap, "my_feature_enabled") || togMap["my_feature_enabled"] !== "true") {
  return { skipped: true };
}
```

If a task checks only ONE of the two → WA can leak even when the toggle is OFF.

## Audit steps

1. Open `api/cron-reminder.js` (and any other file with scheduled handlers). Identify
   every distinct task/handler that can send WA (`sendWA`, Fonnte calls, owner alerts,
   customer reminders).

2. For each task, verify ALL of:
   - [ ] The `app_settings` fetch `.in("key", [...])` array **includes `"cron_jobs"`**.
   - [ ] There is an `isCronJobEnabled(togMap, "<key>")` check.
   - [ ] There is ALSO a standalone `togMap["<key>"] === "true"` check.
   - [ ] Both are combined so that **either** being false short-circuits to skip
     (i.e. `!isCronJobEnabled(...) || togMap[key] !== "true"` → return/skip).
   - [ ] The toggle key actually exists in the Settings UI sync (SettingsView writes
     BOTH the standalone key AND the `cron_jobs` JSON entry).

3. **Report a table** of task → key → which checks present/missing. Flag any task that:
   - sends WA with no toggle gate at all (CRITICAL),
   - checks only `isCronJobEnabled` OR only the standalone key (HIGH — leak risk),
   - omits `"cron_jobs"` from the fetch (HIGH — `isCronJobEnabled` always sees empty).

4. When **adding** a new cron task, scaffold it with the full pattern above and remind
   the user to add the toggle in SettingsView syncing BOTH the standalone key and the
   `cron_jobs` JSON array entry — otherwise the toggle won't actually control it.

5. Do not "fix" by loosening a gate. If unsure whether a send is customer-facing,
   treat it as customer-facing (fail closed) and ask.

## Cross-check against vercel.json / dispatcher
Per the cron-dispatcher note, Vercel Hobby native cron is unreliable; most tasks run via
the `task=tick` dispatcher pinged by GitHub Actions. A task missing from the dispatcher
won't run at all — flag tasks that exist in code but aren't wired into the dispatcher.
