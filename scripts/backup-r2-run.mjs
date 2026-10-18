// Manual backup uses the exact encrypted worker. Nothing is written without --execute.
if (!process.argv.includes('--execute')) {
  console.log('Dry run: encrypted consistent backup to R2. To execute: node --env-file=.env.local scripts/backup-r2-run.mjs --execute');
} else {
  try {
    const { taskBackupData } = await import('../api/_tasks/backup.js');
    const { withDispatcherLease } = await import('../api/_cron-dispatch.js');
    const { sb } = await import('../api/_tasks/_shared.js');
    const result = await withDispatcherLease(sb, () => taskBackupData());
    console.log(JSON.stringify(result));
    if (result.skipped || result.errors) process.exitCode = 1;
  } catch (error) { console.error('Backup failed: ' + error.message); process.exitCode = 1; }
}
