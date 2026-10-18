// Default: download/validate only. --drill restores into disposable in-memory PGlite,
// never into Supabase or public.restore_test_* tables. No URLs to a restore DB accepted.
import { downloadBufferFromR2 } from '../api/_r2-upload.js';
import { BACKUP_TABLES, unpackBackup, readLegacyBackup, verifyBackupRelations } from '../api/_backup.js';
import { drillBackupInMemory } from './lib/backup-drill.mjs';
const args = process.argv.slice(2), option = key => args.find(a => a.startsWith(key + '='))?.slice(key.length + 1);
async function download(key) {
  const result = await downloadBufferFromR2(key);
  if (!result.ok) throw new Error('Read backup failed: ' + result.err);
  return result.buffer;
}
try {
  const manifestKey = option('--manifest-key'), legacy = option('--legacy-date');
  if (manifestKey) {
    if (!/^backup\/\d{4}-\d{2}-\d{2}\/manifest-[a-f0-9-]{36}\.json$/.test(manifestKey)) throw new Error('Invalid manifest key');
    const manifest = JSON.parse((await download(manifestKey)).toString('utf8'));
    if (!/^backup\/\d{4}-\d{2}-\d{2}\/bundle-[a-f0-9-]{36}\.json\.gz\.enc$/.test(manifest.bundle_key || '') || !manifest.bundle_key.startsWith(manifestKey.slice(0, 18))) throw new Error('Invalid bundle key');
    const bundle = unpackBackup(await download(manifest.bundle_key), { encryptionKey: process.env.BACKUP_ENCRYPTION_KEY, manifest });
    const relations = verifyBackupRelations(bundle);
    console.log(JSON.stringify({ archiveVerified: true, tables: BACKUP_TABLES.length, relations, productionWrites: 0 }));
    if (args.includes('--drill')) {
      const { PGlite } = await import(process.env.WA_PGLITE_MODULE || '@electric-sql/pglite');
      const db = new PGlite();
      try { console.log(JSON.stringify(await drillBackupInMemory(db, bundle))); } finally { await db.close(); }
    }
  } else if (legacy) {
    if (!/^\d{4}-\d{2}(?:-\d{2})?$/.test(legacy)) throw new Error('Invalid legacy date');
    if (args.includes('--drill')) throw new Error('Legacy archives have no schema; validate only, not a full restore drill');
    for (const table of ['invoices','orders','customers','service_reports']) {
      let result = await downloadBufferFromR2('backup/' + legacy + '/' + table + '.json.gz');
      if (!result.ok && result.err === 'R2 GET 404') result = await downloadBufferFromR2('backup/' + legacy + '/' + table + '.json');
      if (!result.ok) throw new Error('Legacy read failed: ' + result.err);
      const data = readLegacyBackup(result.buffer);
      if (data.table !== table) throw new Error('Wrong legacy table');
      console.log(JSON.stringify({ table, rows: data.count, archiveVerified: true, productionWrites: 0 }));
    }
  } else {
    console.log('Usage: node --env-file=.env.local scripts/restore-verify-run.mjs --manifest-key=backup/YYYY-MM-DD/manifest-UUID.json [--drill]');
    console.log('Old format: --legacy-date=YYYY-MM-DD (gzip or JSON, read-only validation)');
  }
} catch (error) { console.error('Restore verification failed: ' + error.message); process.exitCode = 1; }
